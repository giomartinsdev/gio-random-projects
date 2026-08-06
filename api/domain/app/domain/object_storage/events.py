"""MinIO-backed object storage exposed as domain events, so bucket/object
management goes through the same pattern every other domain follows here
— dispatch through the gateway's authenticated proxy, audited in
domain_event_store (see service/dispatcher.py) — instead of talking to
MinIO's S3 API directly.

MinIO's own S3 API (minio-api.giomartins.dev, see
infra/cloudflared/config.yml) is deliberately NOT behind Cloudflare
Access, but that's for SigV4-signing server callers like
ArchiveVehiclePositionHistory (app/domain/vehicle_position/archive_events.py)
that hold real MinIO credentials — it can't do Access's browser-redirect
dance any more than a plain HTTP caller can. The console
(minio.giomartins.dev) IS behind Access, which blocks exactly that kind
of caller. The events below are the answer for "I need to manage MinIO
from something that only has a gateway API key, not MinIO credentials
or a browser session" — same shape as every other domain event, proxied
through gateway.giomartins.dev.

Binary payloads travel base64-encoded, since the transport here is a
JSON request/response body like every other event.
"""

from __future__ import annotations

import base64
from datetime import (
    datetime,  # noqa: TC003 — pydantic resolves field annotations at class-creation time, not just for static typing
)
from typing import TYPE_CHECKING, Any

from botocore.exceptions import ClientError
from pydantic import BaseModel

from app.domain.base import DomainEvent
from app.domain.object_storage.entity import StorageObject
from app.infrastructure.object_storage import get_s3_client

if TYPE_CHECKING:
    from sqlmodel import Session

_ALREADY_OWNED_CODES = {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}
_NOT_FOUND_CODES = {"NoSuchKey", "404"}


def _error_code(exc: ClientError) -> str | None:
    return exc.response.get("Error", {}).get("Code")


class CreateBucket(DomainEvent[StorageObject]):
    """Creates a bucket if it doesn't already exist. Idempotent — MinIO's
    own "already owned by you" case is treated as success, not an error,
    since the caller's intent ("this bucket should exist") is already
    satisfied either way."""

    bucket: str

    def handle(self, session: Session) -> bool:  # noqa: ARG002 — no DB row involved; session only exists to satisfy DomainEvent's contract
        try:
            get_s3_client().create_bucket(Bucket=self.bucket)
        except ClientError as exc:
            if _error_code(exc) not in _ALREADY_OWNED_CODES:
                raise
            return False
        return True


class PutObject(DomainEvent[StorageObject]):
    """Uploads one object. `data_base64` is the object body, base64-encoded
    for JSON transport."""

    bucket: str
    key: str
    data_base64: str
    content_type: str | None = None

    def handle(self, session: Session) -> None:  # noqa: ARG002
        kwargs: dict[str, Any] = {
            "Bucket": self.bucket,
            "Key": self.key,
            "Body": base64.b64decode(self.data_base64),
        }
        if self.content_type is not None:
            kwargs["ContentType"] = self.content_type
        get_s3_client().put_object(**kwargs)


class StorageObjectData(BaseModel):
    key: str
    content_type: str | None
    data_base64: str


class GetObject(DomainEvent[StorageObject]):
    """Fetches one object's body + content type. Returns None if the key
    doesn't exist — same "absence is a value, not an error" convention as
    GetById in app/domain/base.py."""

    bucket: str
    key: str

    def handle(self, session: Session) -> StorageObjectData | None:  # noqa: ARG002
        try:
            response = get_s3_client().get_object(Bucket=self.bucket, Key=self.key)
        except ClientError as exc:
            if _error_code(exc) not in _NOT_FOUND_CODES:
                raise
            return None
        body = response["Body"].read()
        return StorageObjectData(
            key=self.key,
            content_type=response.get("ContentType"),
            data_base64=base64.b64encode(body).decode("ascii"),
        )


class StorageObjectMeta(BaseModel):
    key: str
    size: int
    last_modified: datetime


class ListObjects(DomainEvent[StorageObject]):
    """Lists keys under an optional prefix — one page of MinIO's own
    ListObjectsV2 (max_keys); pagination past that isn't needed yet by
    any caller."""

    bucket: str
    prefix: str = ""
    max_keys: int = 1000

    def handle(self, session: Session) -> list[StorageObjectMeta]:  # noqa: ARG002
        response = get_s3_client().list_objects_v2(
            Bucket=self.bucket, Prefix=self.prefix, MaxKeys=self.max_keys
        )
        return [
            # boto3-stubs marks Key/Size/LastModified as NotRequired on
            # ObjectTypeDef in general (some other S3 API responses reuse
            # this TypedDict without them), but ListObjectsV2 always
            # populates all three for every entry — confirmed by testing
            # against the fake client's own list_objects_v2.
            StorageObjectMeta(
                key=obj["Key"],  # pyright: ignore[reportTypedDictNotRequiredAccess]
                size=obj["Size"],  # pyright: ignore[reportTypedDictNotRequiredAccess]
                last_modified=obj["LastModified"],  # pyright: ignore[reportTypedDictNotRequiredAccess]
            )
            for obj in response.get("Contents", [])
        ]


class DeleteObject(DomainEvent[StorageObject]):
    """Deletes one object. Always returns True — S3's (and MinIO's)
    DeleteObject succeeds whether or not the key existed, so there's no
    meaningful False case to report."""

    bucket: str
    key: str

    def handle(self, session: Session) -> bool:  # noqa: ARG002
        get_s3_client().delete_object(Bucket=self.bucket, Key=self.key)
        return True

"""MinIO-backed object storage exposed as domain events, so bucket/object
management goes through the same pattern every other domain follows here
— dispatch through the gateway's authenticated proxy, audited in
domain_event_store (see service/dispatcher.py) — instead of talking to
MinIO's S3 API directly.

MinIO's own S3 API (minio-api.giomartins.dev) sits behind a Cloudflare
Zero Trust Access Application in practice, even though a SigV4-signing
caller can't do Access's browser-redirect dance any more than a plain
HTTP caller could — see app/infrastructure/object_storage.py's
get_s3_client(), which sends the same CF-Access-Client-Id/Secret
Service Token headers this domain's own OTel export already uses,
rather than relying on that hostname being excluded from Access. The
console (minio.giomartins.dev) is also behind Access, blocking that
same kind of caller from the opposite direction with no Service Token
workaround available. The events below are the answer either way: "I
need to manage MinIO from something that only has a gateway API key,
not MinIO credentials or a browser session" — same shape as every
other domain event, proxied through gateway.giomartins.dev.
flows/vehicle_position_archiver is exactly such a caller: it uses
CreateBucket/PutObject here instead of talking to MinIO directly.

Binary payloads travel base64-encoded, since the transport here is a
JSON request/response body like every other event.
"""

from __future__ import annotations

import base64
from datetime import (
    datetime,  # noqa: TC003 — pydantic resolves field annotations at class-creation time, not just for static typing
)
from typing import TYPE_CHECKING, Any, ClassVar

from botocore.exceptions import ClientError
from pydantic import BaseModel

from app.domain.base import DomainEvent
from app.domain.object_storage.entity import StorageObject
from app.infrastructure.object_storage import MINIO_REGION, get_s3_client

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
            # botocore special-cases LocationConstraint="us-east-1" by
            # omitting the CreateBucketConfiguration body entirely
            # (mirroring real AWS, where that's the implicit default
            # region needing no constraint) — MinIO doesn't extend it
            # the same courtesy and rejects the resulting empty body
            # with MalformedXML. Confirmed live: any other
            # LocationConstraint value (MinIO doesn't validate it
            # beyond "is a body present") works fine; MINIO_REGION is
            # never "us-east-1", so this always sends one.
            get_s3_client().create_bucket(
                Bucket=self.bucket,
                # boto3-stubs types LocationConstraint as a Literal of
                # real AWS region codes — MinIO doesn't have AWS
                # regions and doesn't validate this value at all, so a
                # made-up one is genuinely fine at runtime, just not
                # expressible in that Literal type.
                CreateBucketConfiguration={
                    "LocationConstraint": MINIO_REGION  # pyright: ignore[reportArgumentType]
                },
            )
        except ClientError as exc:
            if _error_code(exc) not in _ALREADY_OWNED_CODES:
                raise
            return False
        return True


class PutObject(DomainEvent[StorageObject]):
    """Uploads one object. `data_base64` is the object body, base64-encoded
    for JSON transport."""

    __http_method__: ClassVar[str] = "PUT"

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

    __http_method__: ClassVar[str] = "GET"

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

    __http_method__: ClassVar[str] = "GET"

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

    __http_method__: ClassVar[str] = "DELETE"

    bucket: str
    key: str

    def handle(self, session: Session) -> bool:  # noqa: ARG002
        get_s3_client().delete_object(Bucket=self.bucket, Key=self.key)
        return True

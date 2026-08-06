"""S3-compatible client for MinIO. Used by app/domain/object_storage's
events (CreateBucket/PutObject/GetObject/ListObjects/DeleteObject) — the
domain's only object-storage-facing code, now that archiving policy
(which bucket, which key naming, when to prune) has moved to
flows/vehicle_position_archiver, which calls those same generic events
through the gateway instead of touching MinIO directly. A thin wrapper
(not a class) for the same reason infrastructure/db.py's engine is a
module-level singleton: one client, created once, reused across
requests.

minio-api.giomartins.dev sits behind Cloudflare Access (a Zero Trust
Access Application on that hostname) even though it's meant for
SigV4-signing server callers like this one, not a browser — same
category of caller as this domain's own OTel exporter, which already
authenticates the same way (see compose.yaml's CF_ACCESS_CLIENT_ID/
CF_ACCESS_CLIENT_SECRET). Every request from this client needs the same
two headers, or Access silently swaps the real S3 response for an HTML
login redirect — confirmed live: that redirect is what was crashing
CreateBucket with a RecursionError (botocore's redirect_from_error
handler tried to parse the login page as an S3 error body, extracted no
bucket name from it, and looped) before this header injection was added.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

import boto3

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

# Any fixed value works — MinIO has no real AWS regions and doesn't
# validate this beyond "does it match the client's own signing region",
# which get_s3_client() below always sets to the same constant.
MINIO_REGION = "minio"


def _inject_cf_access_headers(request: Any, **kwargs: Any) -> None:  # noqa: ANN401, ARG001 — botocore's before-send event passes a variable kwargs bag we don't otherwise need
    # Registered on `before-send`, which fires after SigV4 signing —
    # these headers are never part of the signature, only real AWS
    # request headers are, so adding them here can't invalidate it.
    client_id = os.environ.get("CF_ACCESS_CLIENT_ID")
    client_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET")
    if client_id and client_secret:
        request.headers["CF-Access-Client-Id"] = client_id
        request.headers["CF-Access-Client-Secret"] = client_secret


def get_s3_client() -> S3Client:
    # boto3-stubs' own overload set still leaves this particular
    # overload branch partially unknown — the explicit -> S3Client
    # return annotation above is what actually gives callers a typed
    # client; this ignore is scoped to boto3's own construction call.
    client = boto3.client(  # pyright: ignore[reportUnknownMemberType]
        "s3",
        endpoint_url=os.environ.get("MINIO_ENDPOINT_URL", "http://localhost:9000"),
        aws_access_key_id=os.environ["MINIO_ACCESS_KEY"],
        aws_secret_access_key=os.environ["MINIO_SECRET_KEY"],
        region_name=MINIO_REGION,
    )
    client.meta.events.register("before-send.s3.*", _inject_cf_access_headers)
    return client

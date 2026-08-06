"""S3-compatible client for MinIO. Used by app/domain/object_storage's
events (CreateBucket/PutObject/GetObject/ListObjects/DeleteObject) — the
domain's only object-storage-facing code, now that archiving policy
(which bucket, which key naming, when to prune) has moved to
flows/vehicle_position_archiver, which calls those same generic events
through the gateway instead of touching MinIO directly. A thin wrapper
(not a class) for the same reason infrastructure/db.py's engine is a
module-level singleton: one client, created once, reused across
requests.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import boto3

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


def get_s3_client() -> S3Client:
    # boto3-stubs' own overload set still leaves this particular
    # overload branch partially unknown — the explicit -> S3Client
    # return annotation above is what actually gives callers a typed
    # client; this ignore is scoped to boto3's own construction call.
    return boto3.client(  # pyright: ignore[reportUnknownMemberType]
        "s3",
        endpoint_url=os.environ.get("MINIO_ENDPOINT_URL", "http://localhost:9000"),
        aws_access_key_id=os.environ["MINIO_ACCESS_KEY"],
        aws_secret_access_key=os.environ["MINIO_SECRET_KEY"],
    )

# httpx's TestClient.post()/.get()/.put()/.delete()/.json() surfaces
# Unknown/Any through its own stubs regardless of caller code (see
# test_event_store_steps.py's identical note) — these steps assert
# against raw wire-level JSON responses, exactly the case where that's
# unavoidable.
# botocore-stubs marks Error/Code as NotRequired on ClientError's own
# response TypedDict in general — real error responses always populate
# them, same reasoning as object_storage/events.py's own _error_code().
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportTypedDictNotRequiredAccess=false

from __future__ import annotations

import base64
from typing import TYPE_CHECKING, Any

import pytest
from botocore.exceptions import ClientError
from pytest_bdd import given, parsers, scenarios, then, when

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

scenarios("../features/object_storage_events.feature")

_BODY = b"\x00\x01binary-data"


@given(
    "a domain API backed by a real Postgres database and a real MinIO server",
    target_fixture="client",
)
def _given_domain_api_with_minio(client: TestClient, minio_env: None) -> TestClient:  # noqa: ARG001 — minio_env activates the monkeypatched env vars
    return client


@given(parsers.parse('bucket "{bucket}" already exists'))
def _given_bucket_exists(client: TestClient, bucket: str) -> None:
    response = client.post("/events/create-bucket", json={"bucket": bucket})
    assert response.status_code == 200


@given(parsers.parse('key "{key}" exists in bucket "{bucket}"'))
def _given_key_exists(client: TestClient, bucket: str, key: str) -> None:
    response = client.put(
        "/events/put-object",
        json={"bucket": bucket, "key": key, "data_base64": base64.b64encode(b"x").decode()},
    )
    assert response.status_code == 200


@given(parsers.parse('keys "{k1}", "{k2}" and "{k3}" exist in bucket "{bucket}"'))
def _given_three_keys_exist(client: TestClient, bucket: str, k1: str, k2: str, k3: str) -> None:
    for key in (k1, k2, k3):
        response = client.put(
            "/events/put-object",
            json={"bucket": bucket, "key": key, "data_base64": base64.b64encode(b"x").decode()},
        )
        assert response.status_code == 200


@when(parsers.parse('bucket "{bucket}" is created'), target_fixture="response")
def _when_bucket_created(client: TestClient, bucket: str) -> Any:
    return client.post("/events/create-bucket", json={"bucket": bucket})


def _put_binary(client: TestClient, bucket: str, key: str) -> Any:
    payload = base64.b64encode(_BODY).decode("ascii")
    return client.put(
        "/events/put-object",
        json={
            "bucket": bucket,
            "key": key,
            "data_base64": payload,
            "content_type": "application/octet-stream",
        },
    )


@when(
    parsers.parse('binary data is put at key "{key}" in bucket "reports"'),
    target_fixture="response",
)
def _when_binary_data_put(client: TestClient, key: str) -> Any:
    return _put_binary(client, "reports", key)


@when(
    parsers.parse('binary data is put at key "{key}" in bucket "does-not-exist"'),
    target_fixture="put_error",
)
def _when_binary_data_put_missing_bucket(client: TestClient, key: str) -> BaseException:
    try:
        _put_binary(client, "does-not-exist", key)
    except Exception as exc:
        return exc
    pytest.fail("expected put-object against a nonexistent bucket to raise")


@when(parsers.parse('key "{key}" is fetched from bucket "{bucket}"'), target_fixture="response")
def _when_key_fetched(client: TestClient, bucket: str, key: str) -> Any:
    return client.get("/events/get-object", params={"bucket": bucket, "key": key})


@when(parsers.parse('key "{key}" in bucket "{bucket}" is deleted'), target_fixture="response")
def _when_key_deleted(client: TestClient, bucket: str, key: str) -> Any:
    return client.delete("/events/delete-object", params={"bucket": bucket, "key": key})


@when(
    parsers.parse('objects under prefix "{prefix}" in bucket "{bucket}" are listed'),
    target_fixture="response",
)
def _when_objects_listed(client: TestClient, bucket: str, prefix: str) -> Any:
    return client.get("/events/list-objects", params={"bucket": bucket, "prefix": prefix})


@when(parsers.parse('all objects in bucket "{bucket}" are listed'), target_fixture="response")
def _when_all_objects_listed(client: TestClient, bucket: str) -> Any:
    return client.get("/events/list-objects", params={"bucket": bucket})


@then("the response is true")
def _then_response_true(response: Any) -> None:
    assert response.status_code == 200
    assert response.json() is True


@then("the response is false")
def _then_response_false(response: Any) -> None:
    assert response.status_code == 200
    assert response.json() is False


@then("the response is null")
def _then_response_null(response: Any) -> None:
    assert response.status_code == 200
    assert response.json() is None


@then(parsers.parse('the fetched object\'s content type is "{content_type}"'))
def _then_content_type(response: Any, content_type: str) -> None:
    assert response.json()["content_type"] == content_type


@then("the fetched object's body matches what was put")
def _then_body_matches(response: Any) -> None:
    body = response.json()
    assert base64.b64decode(body["data_base64"]) == _BODY


@then(parsers.parse('the listed keys are exactly "{k1}" and "{k2}"'))
def _then_listed_keys_exactly_two(response: Any, k1: str, k2: str) -> None:
    keys = sorted(item["key"] for item in response.json())
    assert keys == sorted([k1, k2])


@then("the listed keys are exactly none")
def _then_listed_keys_empty(response: Any) -> None:
    assert response.json() == []


@then("the request fails with a real S3 error")
def _then_request_fails(put_error: BaseException) -> None:
    assert isinstance(put_error, ClientError)
    assert put_error.response["Error"]["Code"] == "NoSuchBucket"

from uuid import uuid4

import pytest
from sqlalchemy.exc import OperationalError

from job_manager.worker import Worker


def test_submit_process_and_retrieve_result(client):
    response = client.post("/v1/jobs", json={"parameters": {"samples": 10_000, "seed": 42}})
    assert response.status_code == 202
    job = response.json()
    assert response.headers["location"] == f"/v1/jobs/{job['id']}"
    assert job["status"] == "queued" and job["attempts"] == 0
    assert job["created_at"].endswith("Z")
    assert Worker(client.app.state.store).run_once()
    finished = client.get(response.headers["location"]).json()
    assert finished["status"] == "succeeded"
    assert finished["progress"] == 1 and finished["attempts"] == 1
    assert finished["result"]["samples"] == 10_000
    assert finished["result"]["absolute_error"] < 0.1
    assert finished["result"]["estimated_standard_error"] > 0
    assert finished["finished_at"] is not None
    assert "lease_token" not in finished and "request_hash" not in finished
    events = client.get(f"/v1/jobs/{job['id']}/events").json()
    assert [event["status"] for event in events] == ["queued", "running", "succeeded"]
    assert client.post(f"/v1/jobs/{job['id']}/cancel").status_code == 409
    assert client.post(f"/v1/jobs/{job['id']}/retry").status_code == 409


def test_authentication_and_public_health(client):
    client.headers.clear()
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/v1/jobs").status_code == 401
    assert client.post("/v1/jobs", json={}).status_code == 401
    assert client.get("/v1/jobs", headers={"X-API-Key": "wrong"}).status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "arbitrary_command"},
        {"parameters": {"samples": 999}},
        {"parameters": {"samples": 5_000_001}},
        {"parameters": {"samples": True}},
        {"parameters": {"seed": -1}},
        {"parameters": {"seed": 2**32}},
        {"parameters": {"samples": 1000.5}},
        {"parameters": {"extra": "ignored?"}},
        {"max_attempts": 0},
        {"max_attempts": 6},
        {"extra": "ignored?"},
    ],
)
def test_rejects_invalid_workloads(client, body):
    assert client.post("/v1/jobs", json=body).status_code == 422
    assert client.get("/v1/jobs").json()["total"] == 0


def test_idempotency_replays_and_detects_conflicts(client):
    headers = {"Idempotency-Key": "submission-123"}
    first = client.post("/v1/jobs", json={}, headers=headers)
    second = client.post("/v1/jobs", json={}, headers=headers)
    assert first.status_code == 202 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    conflict = client.post("/v1/jobs", json={"parameters": {"seed": 7}}, headers=headers)
    assert conflict.status_code == 409
    assert client.get("/v1/jobs").json()["total"] == 1
    assert (
        client.post("/v1/jobs", json={}, headers={"Idempotency-Key": "bad key"}).status_code == 422
    )


def test_cancel_retry_and_paginated_lists(client):
    ids = [client.post("/v1/jobs", json={}).json()["id"] for _ in range(3)]
    path = f"/v1/jobs/{ids[0]}"
    assert client.post(path + "/cancel").json()["status"] == "cancelled"
    assert client.post(path + "/cancel").status_code == 200
    events = client.get(path + "/events").json()
    assert len(events) == 2  # Repeated cancellation does not duplicate the transition.
    page = client.get("/v1/jobs?status=queued&limit=1&offset=1").json()
    assert page["total"] == 2 and len(page["items"]) == 1
    assert page["items"][0]["id"] in ids[1:]
    assert client.get("/v1/jobs?limit=101").status_code == 422
    assert client.get("/v1/jobs?status=unknown").status_code == 422
    assert client.post(path + "/retry").json()["status"] == "queued"
    assert client.post(path + "/retry").status_code == 409
    event = client.get(path + "/events?limit=1&offset=1").json()
    assert len(event) == 1 and event[0]["status"] == "cancelled"


def test_missing_and_malformed_ids(client):
    path = f"/v1/jobs/{uuid4()}"
    for method, suffix in [
        ("get", ""),
        ("get", "/events"),
        ("post", "/cancel"),
        ("post", "/retry"),
    ]:
        assert getattr(client, method)(path + suffix).status_code == 404
    assert client.get("/v1/jobs/not-a-uuid").status_code == 422


def test_openapi_documents_authentication(client):
    schema = client.get("/openapi.json").json()
    assert schema["components"]["securitySchemes"]["APIKeyHeader"]["name"] == "X-API-Key"
    assert schema["paths"]["/v1/jobs"]["post"]["security"]
    assert client.get("/docs").status_code == 200


def test_health_failure_is_unavailable_without_connection_details(client, engine, monkeypatch):
    def unavailable():
        raise OperationalError("private connection details", None, RuntimeError("offline"))

    monkeypatch.setattr(engine, "connect", unavailable)
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}

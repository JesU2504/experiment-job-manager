"""Exercise a running API and separate worker over real HTTP, using only the stdlib."""

import json
import os
import time
import urllib.error
import urllib.request
from uuid import uuid4


def main():
    base = os.getenv("EJM_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    key = os.environ["EJM_API_KEY"]

    def call(path, body=None, idempotency=None):
        headers = {"X-API-Key": key, "Content-Type": "application/json"}
        if idempotency:
            headers["Idempotency-Key"] = idempotency
        request = urllib.request.Request(
            base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.load(response)

    assert call("/health")[1] == {"status": "ok"}
    # A container deployment includes the custom dashboard, alongside the API.
    with urllib.request.urlopen(base + "/", timeout=10) as response:
        dashboard = response.read().decode()
        assert "Experiment Job Manager" in dashboard and 'id="root"' in dashboard
    payload = {"parameters": {"samples": 100_000, "seed": 42}}
    idempotency = f"smoke-{uuid4()}"
    status, job = call("/v1/jobs", payload, idempotency)
    assert status == 202
    status, replay = call("/v1/jobs", payload, idempotency)
    assert status == 200 and replay["id"] == job["id"]
    path = f"/v1/jobs/{job['id']}"
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        job = call(path)[1]
        if job["status"] in {"succeeded", "failed", "cancelled"}:
            break
        time.sleep(0.1)
    assert job["status"] == "succeeded", job
    assert job["result"]["absolute_error"] < 0.1
    events = [event["status"] for event in call(path + "/events")[1]]
    assert events == ["queued", "running", "succeeded"], events
    print(
        json.dumps(
            {
                "job_id": job["id"],
                "status": job["status"],
                "pi_estimate": job["result"]["pi_estimate"],
                "events": events,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

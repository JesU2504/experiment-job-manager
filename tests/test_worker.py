import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest

from job_manager.experiments import monte_carlo_pi
from job_manager.schemas import CreateJob
from job_manager.store import Conflict, JobStore
from job_manager.worker import Worker


def request(**kwargs):
    return CreateJob(parameters={"samples": 1000, "seed": 42}, **kwargs)


def test_same_seed_reproduces_result():
    progress = []
    first = monte_carlo_pi({"samples": 25_000, "seed": 7}, lambda p: progress.append(p) or True)
    second = monte_carlo_pi({"samples": 25_000, "seed": 7}, lambda _: True)
    assert first == second
    assert progress == [0, 0.4, 0.8, 1]
    assert abs(first["pi_estimate"] - 3.141592653589793) < 0.1


def test_competing_workers_cannot_claim_the_same_job(engine, store):
    job, _ = store.create(request())
    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(lambda _: JobStore(engine).claim_next(), range(4)))
    winners = [claim for claim in claims if claim is not None]
    assert len(winners) == 1 and winners[0].id == job.id
    assert store.get(job.id).attempts == 1
    assert [event.status for event in store.events(job.id)] == ["queued", "running"]


def test_concurrent_idempotent_submissions_create_one_job(engine, store):
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: JobStore(engine).create(request(), "same-key"), range(4)))
    assert len({job.id for job, _ in results}) == 1
    assert sum(created for _, created in results) == 1
    assert store.list().total == 1


def test_cancellation_fences_worker_completion_and_retry(engine, store):
    job, _ = store.create(request())
    stale = store.claim_next()
    assert store.cancel(job.id).status == "cancelled"
    assert not store.checkpoint(stale, 0.5)
    assert not store.finish(stale, {"pi_estimate": 0})
    store.retry(job.id)
    current = JobStore(engine).claim_next()
    assert current.token != stale.token
    assert not store.fail(stale, "late failure")
    assert store.finish(current, {"pi_estimate": 3.14})
    assert store.get(job.id).result == {"pi_estimate": 3.14}
    assert store.get(job.id).attempts == 2


def test_running_experiment_stops_on_cancellation(store):
    job, _ = store.create(request())

    def cancel_during_run(parameters, checkpoint):
        store.cancel(job.id)
        return monte_carlo_pi(parameters, checkpoint)

    assert Worker(store, runner=cancel_during_run).run_once()
    result = store.get(job.id)
    assert result.status == "cancelled" and result.result is None
    assert [event.status for event in store.events(job.id)] == ["queued", "running", "cancelled"]


def test_expired_lease_is_requeued_and_old_token_is_rejected(engine):
    now = [1_700_000_000.0]
    store = JobStore(engine, lease_seconds=5, clock=lambda: now[0])
    job, _ = store.create(request(max_attempts=2))
    stale = store.claim_next()
    now[0] += 5
    assert not store.checkpoint(stale, 0.5)  # An expired owner cannot revive its lease.
    assert store.recover_expired() == 1
    assert store.get(job.id).status == "queued"
    current = store.claim_next()
    assert not store.finish(stale, {"pi_estimate": 0})
    assert store.finish(current, {"pi_estimate": 3.14})
    assert store.get(job.id).attempts == 2


def test_recovery_respects_attempt_budget(engine):
    now = [1_700_000_000.0]
    store = JobStore(engine, lease_seconds=5, clock=lambda: now[0])
    job, _ = store.create(request(max_attempts=1))
    store.claim_next()
    now[0] += 6
    assert store.recover_expired() == 1
    assert store.get(job.id).status == "failed"
    assert store.claim_next() is None
    with pytest.raises(Conflict):
        store.retry(job.id)


def test_failure_then_manual_retry(store):
    job, _ = store.create(request())

    def broken(_parameters, _checkpoint):
        raise ValueError("private details must not appear in the API response")

    Worker(store, runner=broken).run_once()
    assert store.get(job.id).status == "failed"
    assert store.get(job.id).error == "Job execution failed (ValueError)."
    store.retry(job.id)
    assert Worker(store).run_once()
    assert store.get(job.id).status == "succeeded"
    assert store.get(job.id).error is None


def test_worker_can_run_as_a_separate_process(engine, store):
    job, _ = store.create(request())
    env = dict(
        os.environ,
        EJM_DATABASE_URL=engine.url.render_as_string(hide_password=False),
        EJM_API_KEY="test-only-key-for-the-worker-process",
    )
    process = subprocess.run(
        [sys.executable, "-m", "job_manager.worker", "--once"],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert process.returncode == 0, process.stderr
    assert store.get(job.id).status == "succeeded"
    assert "job_finished" in process.stderr


def test_idle_worker_does_not_create_jobs(store):
    assert Worker(store).run_once() is False
    assert store.list().total == 0

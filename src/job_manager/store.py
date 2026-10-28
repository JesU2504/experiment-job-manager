"""Transactional state changes shared by the HTTP service and worker.

Conditional UPDATE statements arbitrate races. Lease tokens fence stale workers
after a cancellation, crash recovery, or retry. Execution is at least once.
"""

import hashlib
import json
import time
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from job_manager.database import session_factory
from job_manager.models import Job, JobEvent
from job_manager.schemas import CreateJob, EventView, JobPage, JobView


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


@dataclass(frozen=True)
class Claim:
    id: str
    token: str
    parameters: dict


class JobStore:
    def __init__(self, engine, lease_seconds=30, clock=time.time):
        self.sessions = session_factory(engine)
        self.lease_seconds = lease_seconds
        self.clock = clock

    def _event(self, session, job_id, status, message, now):
        session.add(JobEvent(job_id=job_id, status=status, message=message, created_at=now))

    def create(self, request: CreateJob, key: str | None = None) -> tuple[JobView, bool]:
        payload = request.model_dump(mode="json")
        fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

        def replay(job):
            if job.request_hash != fingerprint:
                raise Conflict("Idempotency key was already used for a different request")
            return JobView.model_validate(job), False

        try:
            with self.sessions.begin() as session:
                if key:
                    existing = session.scalar(select(Job).where(Job.idempotency_key == key))
                    if existing is not None:
                        return replay(existing)
                now = self.clock()
                job = Job(
                    id=str(uuid4()),
                    kind=request.kind,
                    parameters=payload["parameters"],
                    max_attempts=request.max_attempts,
                    idempotency_key=key,
                    request_hash=fingerprint,
                    created_at=now,
                    updated_at=now,
                )
                session.add(job)
                session.flush()
                self._event(session, job.id, "queued", "Job submitted.", now)
                return JobView.model_validate(job), True
        except IntegrityError:
            # A concurrent request can win the unique-key insert after our lookup.
            if key:
                with self.sessions() as session:
                    existing = session.scalar(select(Job).where(Job.idempotency_key == key))
                    if existing is not None:
                        return replay(existing)
            raise

    def get(self, job_id: str) -> JobView:
        with self.sessions() as session:
            job = session.get(Job, job_id)
            if job is None:
                raise NotFound("Job not found")
            return JobView.model_validate(job)

    def list(self, status=None, limit=20, offset=0) -> JobPage:
        with self.sessions() as session:
            query = select(Job)
            count = select(func.count()).select_from(Job)
            if status is not None:
                query = query.where(Job.status == status)
                count = count.where(Job.status == status)
            jobs = session.scalars(
                query.order_by(Job.created_at.desc(), Job.id).limit(limit).offset(offset)
            ).all()
            return JobPage(
                items=[JobView.model_validate(job) for job in jobs],
                total=session.scalar(count),
                limit=limit,
                offset=offset,
            )

    def events(self, job_id, limit=100, offset=0):
        with self.sessions() as session:
            if session.get(Job, job_id) is None:
                raise NotFound("Job not found")
            return [
                EventView.model_validate(event)
                for event in session.scalars(
                    select(JobEvent)
                    .where(JobEvent.job_id == job_id)
                    .order_by(JobEvent.id)
                    .limit(limit)
                    .offset(offset)
                )
            ]

    def cancel(self, job_id):
        with self.sessions.begin() as session:
            now = self.clock()
            changed = session.execute(
                update(Job)
                .where(Job.id == job_id, Job.status.in_(["queued", "running"]))
                .values(
                    status="cancelled",
                    lease_token=None,
                    lease_expires_at=None,
                    updated_at=now,
                    finished_at=now,
                )
            ).rowcount
            job = session.get(Job, job_id)
            if job is None:
                raise NotFound("Job not found")
            if changed:
                self._event(session, job_id, "cancelled", "Cancellation requested.", now)
            elif job.status != "cancelled":
                raise Conflict("Only queued or running jobs can be cancelled")
            return JobView.model_validate(job)

    def retry(self, job_id):
        with self.sessions.begin() as session:
            now = self.clock()
            changed = session.execute(
                update(Job)
                .where(
                    Job.id == job_id,
                    Job.status.in_(["failed", "cancelled"]),
                    Job.attempts < Job.max_attempts,
                )
                .values(
                    status="queued",
                    progress=0,
                    result=None,
                    error=None,
                    lease_token=None,
                    lease_expires_at=None,
                    started_at=None,
                    finished_at=None,
                    updated_at=now,
                )
            ).rowcount
            job = session.get(Job, job_id)
            if job is None:
                raise NotFound("Job not found")
            if not changed:
                raise Conflict("Retry requires a failed/cancelled job with attempts remaining")
            self._event(session, job_id, "queued", "Job queued for retry.", now)
            return JobView.model_validate(job)

    def recover_expired(self):
        now = self.clock()
        recovered = 0
        with self.sessions.begin() as session:
            expired = session.execute(
                select(Job.id, Job.lease_token, Job.attempts, Job.max_attempts)
                .where(Job.status == "running", Job.lease_expires_at <= now)
                .limit(100)
            ).all()
            for job_id, token, attempts, max_attempts in expired:
                status = "queued" if attempts < max_attempts else "failed"
                changed = session.execute(
                    update(Job)
                    .where(
                        Job.id == job_id,
                        Job.status == "running",
                        Job.lease_token == token,
                        Job.lease_expires_at <= now,
                    )
                    .values(
                        status=status,
                        progress=0,
                        lease_token=None,
                        lease_expires_at=None,
                        updated_at=now,
                        error="Worker lease expired.",
                        finished_at=now if status == "failed" else None,
                    )
                ).rowcount
                if changed:
                    self._event(session, job_id, status, f"Worker lease expired; {status}.", now)
                    recovered += 1
        return recovered

    def claim_next(self) -> Claim | None:
        for _ in range(8):
            with self.sessions.begin() as session:
                job_id = session.scalar(
                    select(Job.id)
                    .where(Job.status == "queued", Job.attempts < Job.max_attempts)
                    .order_by(Job.created_at, Job.id)
                    .limit(1)
                )
                if job_id is None:
                    return None
                token, now = str(uuid4()), self.clock()
                changed = session.execute(
                    update(Job)
                    .where(
                        Job.id == job_id, Job.status == "queued", Job.attempts < Job.max_attempts
                    )
                    .values(
                        status="running",
                        attempts=Job.attempts + 1,
                        progress=0,
                        lease_token=token,
                        lease_expires_at=now + self.lease_seconds,
                        started_at=now,
                        finished_at=None,
                        updated_at=now,
                        result=None,
                        error=None,
                    )
                ).rowcount
                if changed:
                    job = session.get(Job, job_id)
                    self._event(session, job_id, "running", "Worker claimed job.", now)
                    return Claim(job_id, token, job.parameters)
        return None

    def _owned(self, claim, now):
        return (
            Job.id == claim.id,
            Job.status == "running",
            Job.lease_token == claim.token,
            Job.lease_expires_at > now,
        )

    def checkpoint(self, claim, progress):
        now = self.clock()
        with self.sessions.begin() as session:
            return (
                session.execute(
                    update(Job)
                    .where(*self._owned(claim, now))
                    .values(
                        progress=progress,
                        updated_at=now,
                        lease_expires_at=now + self.lease_seconds,
                    )
                ).rowcount
                == 1
            )

    def finish(self, claim, result):
        return self._complete(claim, "succeeded", result=result)

    def fail(self, claim, error):
        return self._complete(claim, "failed", error=error[:500])

    def _complete(self, claim, status, result=None, error=None):
        now = self.clock()
        with self.sessions.begin() as session:
            changed = session.execute(
                update(Job)
                .where(*self._owned(claim, now))
                .values(
                    status=status,
                    result=result,
                    error=error,
                    updated_at=now,
                    finished_at=now,
                    lease_token=None,
                    lease_expires_at=None,
                    **({"progress": 1} if status == "succeeded" else {}),
                )
            ).rowcount
            if changed:
                self._event(session, claim.id, status, f"Job {status}.", now)
            return changed == 1

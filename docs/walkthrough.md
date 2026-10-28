# Implementation walkthrough

## Follow one request

1. `schemas.py` rejects unsupported job kinds, extra fields and out-of-range inputs.
2. `api.py` authenticates the request and calls `JobStore.create`.
3. `store.py` commits a job and its queued event together, handling idempotency races.
4. `worker.py` recovers expired leases and atomically claims the next queued job.
5. `experiments.py` runs a seeded Monte Carlo experiment and checkpoints each batch.
6. `store.py` commits a result only while that worker still owns a valid lease.
7. The API exposes the result and transition history through read endpoints.

## Exercises before using this as an interview example

- Run the SQLite setup, submit a job in `/docs`, and inspect its events and result.
- Explain why repeating an HTTP request is different from repeating computation.
- Read the conditional update in `claim_next` and its competing-worker test.
- Walk through cancellation followed by retry; explain why the old token fails.
- Change a validation bound and update the relevant test.
- Add a second seeded experiment with its own parameter schema and tests.
- Run the PostgreSQL/Compose setup when Docker is available.

## Questions the design should let you answer

- What survives an API restart? What survives a worker crash?
- Which changes must commit in the same transaction?
- How does a database unique constraint resolve simultaneous submissions?
- Why can a lease expire while a process is still alive?
- What would change if jobs charged a payment method or sent an email?
- What would you measure before introducing a separate message broker?

This milestone is a working foundation. Review and extend it so the design
decisions become examples you can explain from experience.

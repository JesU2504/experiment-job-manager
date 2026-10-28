# Experiment Job Manager

[![CI](https://github.com/JesU2504/experiment-job-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/JesU2504/experiment-job-manager/actions/workflows/ci.yml)

A Python backend for submitting computational experiments, executing them in a
separate worker, and retrieving progress and results through a REST API.
Jobs and transition events persist in SQL. A seeded Monte Carlo estimate of pi
provides a small reproducible workload that runs without a GPU or external API.

## Implemented in the first milestone

- FastAPI endpoints with typed validation, API-key authentication and OpenAPI documentation.
- SQLAlchemy persistence with Alembic migrations, PostgreSQL support and a SQLite local mode.
- A separate worker process with progress checkpoints and bounded computation.
- Idempotent submission, cooperative cancellation and manual retries with attempt budgets.
- Expiring worker leases, automatic recovery after crashes, and tokens that reject stale writes.
- A state-transition event history and paginated, filterable job listings.
- Integration tests for races, cancellation, recovery, failure, migrations and process boundaries.
- GitHub Actions jobs for SQLite, PostgreSQL and a Docker Compose HTTP smoke test.

## Architecture

```mermaid
flowchart LR
    Client[Client or OpenAPI UI] -->|REST and API key| API[FastAPI service]
    API --> SQL[(PostgreSQL or SQLite)]
    Worker[Separate Python worker] -->|Claim and renew lease| SQL
    Worker --> Experiment[Seeded Monte Carlo workload]
    Experiment -->|Progress and result| Worker
    SQL --> Events[Job transition events]
```

```mermaid
stateDiagram-v2
    [*] --> queued: submit
    queued --> running: worker claim
    queued --> cancelled: cancel
    running --> succeeded: commit result
    running --> failed: exception or final lease expiry
    running --> cancelled: cancel
    running --> queued: lease expires with attempts remaining
    failed --> queued: manual retry with attempts remaining
    cancelled --> queued: manual retry with attempts remaining
```

See [the design decisions](docs/design.md) for transaction boundaries and execution guarantees.

## Run locally with SQLite

Requires Python 3.11 or 3.12. Run commands from the repository root.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -c requirements.lock -e ".[dev]"
export EJM_API_KEY="$(python -c 'import secrets; print(secrets.token_hex(24))')"
export EJM_DATABASE_URL=sqlite:///./jobs.db
alembic upgrade head
uvicorn job_manager.api:create_app --factory --host 127.0.0.1 --port 8000
```

In a second terminal, activate the same virtual environment and set the **same**
`EJM_API_KEY` and `EJM_DATABASE_URL` values, then run:

```bash
ejm-worker
```

Open [the interactive API docs](http://127.0.0.1:8000/docs), click **Authorize**,
enter your API key, and submit a job with:

```json
{"kind":"monte_carlo_pi","parameters":{"samples":100000,"seed":42},"max_attempts":3}
```

The API returns `202 Accepted` and a `Location` header. Retrieve that URL until
the status becomes `succeeded`. The response then contains the estimate, error,
sample count, seed and measured execution duration. UTC timestamps use ISO 8601.

To exercise an already running API and worker over HTTP:

```bash
python scripts/smoke.py
```

## Run with Docker and PostgreSQL

Requires Docker with Compose v2. Set two random values in your shell:

```bash
export EJM_API_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
export EJM_DB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
docker compose up --build --wait
python3 scripts/smoke.py
```

Compose starts PostgreSQL, applies migrations once, then starts the API and worker.
The API binds to `127.0.0.1:8000`; PostgreSQL is reachable only within the Compose
network. The named database volume persists across `docker compose down`.
Use `docker compose down` to stop the demo.

## API

All `/v1` routes require `X-API-Key`. Health and interactive documentation are public.

| Method | Route | Behaviour |
| --- | --- | --- |
| POST | `/v1/jobs` | Validate and enqueue a job; optional `Idempotency-Key` header |
| GET | `/v1/jobs` | List jobs; filter by `status`, paginate with `limit` and `offset` |
| GET | `/v1/jobs/{id}` | Retrieve state, progress, timestamps and result |
| POST | `/v1/jobs/{id}/cancel` | Cancel queued/running work; repeating cancellation is harmless |
| POST | `/v1/jobs/{id}/retry` | Requeue failed/cancelled work when attempts remain |
| GET | `/v1/jobs/{id}/events` | Read transition events with pagination |
| GET | `/health` | Database connectivity check; 503 when unavailable |

Reusing an idempotency key with the same validated request returns the existing
job with `200 OK`. Reusing it with a different request returns `409 Conflict`.
Attempts count worker claims. A cancellation before the first claim consumes no
attempt. Explicit execution failures require manual retry; expired leases are
automatically requeued while the attempt budget permits.

## Test and inspect

```bash
ruff check .
ruff format --check .
pytest -q
```

The default suite uses an isolated temporary SQLite database. To run the same
suite against a dedicated **test** PostgreSQL database, set
`EJM_TEST_DATABASE_URL=postgresql+psycopg://user:password@host/database`.
Tests clear the jobs and events tables in that test database.

`requirements.lock` pins the dependency versions used for this milestone.
`pyproject.toml` describes compatible ranges; the lock file constrains installation
for repeatable CI and container builds.

## Scope and next milestones

This is a portfolio backend with a fixed demonstration workload and a single
operator API key. The worker polls the database; computation runs outside the
HTTP server. Delivery is **at least once**. Cancellation is cooperative at batch
boundaries; it cannot instantly stop a CPU instruction already executing.
It does not accept uploaded executable code or provide multi-user accounts.

Next milestones are a TypeScript dashboard, per-user ownership, richer experiment
types, and workload/queue measurements. See [the implementation walkthrough](docs/walkthrough.md)
to understand and extend the current code.

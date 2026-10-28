"""HTTP boundary: validate inputs, authenticate requests, delegate state changes."""

import secrets
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import APIKeyHeader
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from job_manager.database import make_engine
from job_manager.schemas import CreateJob, EventView, JobPage, JobStatus, JobView
from job_manager.settings import Settings
from job_manager.store import Conflict, JobStore, NotFound


def create_app(settings: Settings | None = None, engine=None) -> FastAPI:
    settings = settings or Settings.from_env()
    owns_engine = engine is None
    engine = engine if engine is not None else make_engine(settings.database_url)
    store = JobStore(engine, lease_seconds=settings.lease_seconds)

    @asynccontextmanager
    async def lifespan(_app):
        yield
        if owns_engine:
            engine.dispose()

    app = FastAPI(
        title="Experiment Job Manager",
        version="0.1.0",
        lifespan=lifespan,
        description=(
            "Submit reproducible Monte Carlo experiments to a durable queue. "
            "A separate worker executes jobs and records progress, results and state events. "
            "Use the Authorize button with your X-API-Key."
        ),
    )
    app.state.store = store
    api_key = APIKeyHeader(name="X-API-Key", auto_error=False)

    def authorize(key: Annotated[str | None, Depends(api_key)]):
        if key is None or not secrets.compare_digest(
            key.encode("utf-8"), settings.api_key.encode("utf-8")
        ):
            raise HTTPException(status_code=401, detail="Invalid or missing API key")

    protected = [Depends(authorize)]

    @app.exception_handler(NotFound)
    async def not_found(_request, exc):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(Conflict)
    async def conflict(_request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.get("/", include_in_schema=False)
    def home():
        return RedirectResponse("/docs")

    @app.get("/health", tags=["Health"])
    def health(response: Response):
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return {"status": "ok"}
        except SQLAlchemyError:
            response.status_code = 503
            return {"status": "unavailable"}

    @app.post(
        "/v1/jobs", response_model=JobView, status_code=202, dependencies=protected, tags=["Jobs"]
    )
    def submit(
        request: CreateJob,
        response: Response,
        key: Annotated[
            str | None, Header(alias="Idempotency-Key", pattern=r"^[A-Za-z0-9._:-]{1,128}$")
        ] = None,
    ):
        job, created = store.create(request, key)
        response.status_code = 202 if created else 200
        response.headers["Location"] = f"/v1/jobs/{job.id}"
        return job

    @app.get("/v1/jobs", response_model=JobPage, dependencies=protected, tags=["Jobs"])
    def list_jobs(
        state: Annotated[JobStatus | None, Query(alias="status")] = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
        offset: Annotated[int, Query(ge=0, le=10000)] = 0,
    ):
        return store.list(state, limit, offset)

    @app.get("/v1/jobs/{job_id}", response_model=JobView, dependencies=protected, tags=["Jobs"])
    def get_job(job_id: UUID):
        return store.get(str(job_id))

    @app.get(
        "/v1/jobs/{job_id}/events",
        response_model=list[EventView],
        dependencies=protected,
        tags=["Jobs"],
    )
    def get_events(
        job_id: UUID,
        limit: Annotated[int, Query(ge=1, le=200)] = 100,
        offset: Annotated[int, Query(ge=0, le=10000)] = 0,
    ):
        return store.events(str(job_id), limit, offset)

    @app.post(
        "/v1/jobs/{job_id}/cancel", response_model=JobView, dependencies=protected, tags=["Jobs"]
    )
    def cancel_job(job_id: UUID):
        return store.cancel(str(job_id))

    @app.post(
        "/v1/jobs/{job_id}/retry", response_model=JobView, dependencies=protected, tags=["Jobs"]
    )
    def retry_job(job_id: UUID):
        return store.retry(str(job_id))

    return app

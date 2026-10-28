from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import inspect, update
from sqlalchemy.exc import IntegrityError

from job_manager.database import make_engine
from job_manager.models import Base, Job
from job_manager.schemas import CreateJob
from job_manager.settings import Settings


def test_migration_matches_models(engine):
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []


def test_sqlite_migration_round_trip(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'round-trip.db'}"
    monkeypatch.setenv("EJM_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    engine = make_engine(url)
    assert "jobs" in inspect(engine).get_table_names()
    command.downgrade(config, "base")
    assert "jobs" not in inspect(engine).get_table_names()
    command.upgrade(config, "head")
    assert "job_events" in inspect(engine).get_table_names()
    engine.dispose()


def test_database_rejects_invalid_state(engine, store):
    job, _ = store.create(CreateJob())
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(update(Job).where(Job.id == job.id).values(status="invented"))
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(update(Job).where(Job.id == job.id).values(progress=1.1))


def test_configuration_requires_key_and_bounded_intervals():
    with pytest.raises(ValueError):
        Settings(api_key="short")
    with pytest.raises(ValueError):
        Settings(api_key="x" * 32, lease_seconds=0)
    with pytest.raises(ValueError):
        Settings(api_key="x" * 32, poll_seconds=float("nan"))

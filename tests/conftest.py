import os
from pathlib import Path
from unittest.mock import patch

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import delete

from job_manager.api import create_app
from job_manager.database import make_engine
from job_manager.models import Job, JobEvent
from job_manager.settings import Settings
from job_manager.store import JobStore

ROOT = Path(__file__).resolve().parents[1]
TEST_KEY = "test-only-api-key-with-32-characters"


@pytest.fixture(scope="session")
def engine(tmp_path_factory):
    default = f"sqlite:///{tmp_path_factory.mktemp('database') / 'tests.db'}"
    url = os.getenv("EJM_TEST_DATABASE_URL", default)
    with patch.dict(os.environ, {"EJM_DATABASE_URL": url}):
        command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    db = make_engine(url)
    yield db
    db.dispose()


@pytest.fixture(autouse=True)
def clean_database(engine):
    with engine.begin() as connection:
        connection.execute(delete(JobEvent))
        connection.execute(delete(Job))


@pytest.fixture
def store(engine):
    return JobStore(engine)


@pytest.fixture
def client(engine):
    app = create_app(Settings(api_key=TEST_KEY), engine=engine)
    with TestClient(app, headers={"X-API-Key": TEST_KEY}) as connection:
        yield connection

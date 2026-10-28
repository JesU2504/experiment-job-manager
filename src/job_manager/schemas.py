from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class MonteCarloParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    samples: int = Field(default=100_000, ge=1000, le=5_000_000, strict=True)
    seed: int = Field(default=42, ge=0, le=2**32 - 1, strict=True)


class CreateJob(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["monte_carlo_pi"] = "monte_carlo_pi"
    parameters: MonteCarloParameters = Field(default_factory=MonteCarloParameters)
    max_attempts: int = Field(default=3, ge=1, le=5, strict=True)


class JobView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    kind: str
    parameters: MonteCarloParameters
    status: JobStatus
    progress: float
    attempts: int
    max_attempts: int
    result: dict | None
    error: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class JobPage(BaseModel):
    items: list[JobView]
    total: int
    limit: int
    offset: int


class EventView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: JobStatus
    message: str
    created_at: datetime

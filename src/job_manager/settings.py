"""Read configuration without loading secrets into logs."""

import os
from dataclasses import dataclass
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    database_url: str = "sqlite:///./jobs.db"
    api_key: str = ""
    lease_seconds: float = 30
    poll_seconds: float = 0.5
    cors_origins: tuple[str, ...] = ()
    web_directory: str = ""

    def __post_init__(self):
        if len(self.api_key) < 24:
            raise ValueError("EJM_API_KEY must contain at least 24 characters")
        if not 5 <= self.lease_seconds <= 3600:
            raise ValueError("EJM_LEASE_SECONDS must be between 5 and 3600")
        if not 0.01 <= self.poll_seconds <= 60:
            raise ValueError("EJM_POLL_SECONDS must be between 0.01 and 60")
        for origin in self.cors_origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.username
                or parsed.password
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("EJM_CORS_ORIGINS must contain exact HTTP(S) origins")

    @classmethod
    def from_env(cls):
        return cls(
            database_url=os.getenv("EJM_DATABASE_URL", "sqlite:///./jobs.db"),
            api_key=os.getenv("EJM_API_KEY", ""),
            lease_seconds=float(os.getenv("EJM_LEASE_SECONDS", "30")),
            poll_seconds=float(os.getenv("EJM_POLL_SECONDS", "0.5")),
            cors_origins=tuple(
                origin.strip().rstrip("/")
                for origin in os.getenv("EJM_CORS_ORIGINS", "").split(",")
                if origin.strip()
            ),
            web_directory=os.getenv("EJM_WEB_DIRECTORY", ""),
        )

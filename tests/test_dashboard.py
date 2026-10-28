import pytest
from fastapi.testclient import TestClient

from job_manager.api import create_app
from job_manager.settings import Settings

KEY = "test-only-api-key-with-at-least-32-characters"


def test_dashboard_is_served_without_shadowing_protected_api(engine, tmp_path):
    (tmp_path / "index.html").write_text("<html><title>Experiment Job Manager</title></html>")
    (tmp_path / "asset.js").write_text("console.log('dashboard')")
    app = create_app(Settings(api_key=KEY, web_directory=str(tmp_path)), engine=engine)
    with TestClient(app) as client:
        assert "Experiment Job Manager" in client.get("/").text
        assert client.get("/asset.js").status_code == 200
        assert client.get("/v1/jobs").status_code == 401
        assert client.get("/v1/jobs", headers={"X-API-Key": KEY}).status_code == 200
        assert client.get("/docs").status_code == 200


def test_explicit_cors_origin_allows_dashboard_but_not_other_origins(engine):
    origin = "https://dashboard.example.test"
    app = create_app(Settings(api_key=KEY, cors_origins=(origin,)), engine=engine)
    with TestClient(app) as client:
        headers = {
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-API-Key, Content-Type, Idempotency-Key",
        }
        response = client.options("/v1/jobs", headers=headers)
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
        denied = client.options("/v1/jobs", headers={**headers, "Origin": "https://other.test"})
        assert denied.status_code == 400
        assert "access-control-allow-origin" not in denied.headers
        # CORS configuration does not bypass authentication.
        assert client.get("/v1/jobs", headers={"Origin": origin}).status_code == 401


@pytest.mark.parametrize(
    "origin", ["*", "file:///tmp", "https://host/path", "https://user:pw@host"]
)
def test_invalid_cors_origins_are_rejected(origin):
    with pytest.raises(ValueError):
        Settings(api_key=KEY, cors_origins=(origin,))

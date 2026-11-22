import pytest
from pydantic import ValidationError

from app.config import TEST_PEPPER, Settings


async def test_unconfigured_capabilities_and_authorize_fail_truthfully(
    unconfigured_client_app,
) -> None:
    client, _ = unconfigured_client_app
    response = await client.get("/api/v1/auth/capabilities")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "configuration_required"
    assert body["authorization_path"] is None
    assert body["scopes"] == ["openid", "profile", "email"]
    assert body["missing"] == ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]

    authorize = await client.get("/api/v1/auth/linkedin/authorize")
    assert authorize.status_code == 503
    assert authorize.json()["error"]["code"] == "integration_not_configured"
    assert "location" not in authorize.headers

    callback = await client.get("/api/v1/auth/linkedin/callback")
    assert callback.status_code == 503
    assert callback.json()["error"]["code"] == "integration_not_configured"


async def test_configured_capabilities_and_health(client_app) -> None:
    client, _ = client_app
    response = await client.get("/api/v1/auth/capabilities")
    assert response.json()["status"] == "available"
    assert response.json()["authorization_path"] == "/api/v1/auth/linkedin/authorize"
    assert response.json()["missing"] == []
    assert (await client.get("/health/live")).json() == {"status": "ok"}
    assert (await client.get("/health/ready")).json() == {"status": "ready"}


async def test_cors_is_credentialled_and_not_wildcard(client_app) -> None:
    client, _ = client_app
    response = await client.options(
        "/api/v1/auth/session",
        headers={
            "Origin": "http://localhost:8080",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8080"
    assert response.headers["access-control-allow-credentials"] == "true"
    assert response.headers["access-control-allow-origin"] != "*"

    denied = await client.options(
        "/api/v1/auth/session",
        headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "GET"},
    )
    assert denied.status_code == 400


@pytest.mark.parametrize(
    "override",
    [
        {"cookie_secure": False},
        {"auth_hash_pepper": TEST_PEPPER},
        {"frontend_url": "http://localhost:8080"},
        {"cors_origins": "*"},
        {"cors_origins": "https://other.example.test"},
        {"linkedin_redirect_uri": "http://localhost:8000/callback"},
        {"linkedin_redirect_uri": "https://api.example.test/wrong-callback"},
        {"linkedin_redirect_uri": "https://api.example.test/api/v1/auth/linkedin/callback?x=1"},
    ],
)
def test_production_rejects_insecure_settings(override: dict[str, object]) -> None:
    values: dict[str, object] = {
        "_env_file": None,
        "app_env": "production",
        "database_url": "postgresql+asyncpg://prod:prod@db.internal/hnt",
        "auth_hash_pepper": "a-unique-production-value-that-is-long-enough",
        "cookie_secure": True,
        "frontend_url": "https://app.example.test",
        "cors_origins": "https://app.example.test",
        "linkedin_redirect_uri": "https://api.example.test/api/v1/auth/linkedin/callback",
    }
    values.update(override)
    with pytest.raises(ValidationError, match="Insecure production configuration"):
        Settings(**values)  # type: ignore[arg-type]


def test_production_allows_unconfigured_linkedin_but_not_half_configuration() -> None:
    values: dict[str, object] = {
        "_env_file": None,
        "app_env": "production",
        "database_url": "postgresql+asyncpg://prod:prod@db.internal/hnt",
        "auth_hash_pepper": "a-unique-production-value-that-is-long-enough",
        "cookie_secure": True,
        "frontend_url": "https://app.example.test",
        "cors_origins": "https://app.example.test",
        "linkedin_redirect_uri": "https://api.example.test/api/v1/auth/linkedin/callback",
    }
    assert Settings(**values).linkedin_configured is False  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        Settings(**values, linkedin_client_id="only-half")  # type: ignore[arg-type]


def test_production_supabase_requires_complete_pair_and_https_origin() -> None:
    values: dict[str, object] = {
        "_env_file": None,
        "app_env": "production",
        "database_url": "postgresql+asyncpg://prod:prod@db.internal/hnt",
        "auth_hash_pepper": "a-unique-production-value-that-is-long-enough",
        "cookie_secure": True,
        "frontend_url": "https://app.example.test",
        "cors_origins": "https://app.example.test",
        "linkedin_redirect_uri": "https://api.example.test/api/v1/auth/linkedin/callback",
        "supabase_url": "https://project.supabase.co/",
        "supabase_publishable_key": "publishable-test-value",
    }
    settings = Settings(**values)  # type: ignore[arg-type]
    assert settings.supabase_mode is True
    assert settings.supabase_url == "https://project.supabase.co"
    assert settings.missing_oauth_configuration == []
    with pytest.raises(ValidationError):
        Settings(**{**values, "supabase_publishable_key": ""})  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        Settings(**{**values, "supabase_url": "http://project.supabase.co"})  # type: ignore[arg-type]

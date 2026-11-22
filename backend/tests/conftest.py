import logging
import os
from collections.abc import AsyncIterator
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import ASGITransport, AsyncClient, Response

from app.config import TEST_PEPPER, Settings
from app.database import Base
from app.main import create_app
from app.oidc import LinkedInOIDC, OIDCError
from app.schemas import LinkedInIdentityClaims
from app.supabase_auth import SupabaseLinkedInOIDC


class FakeLinkedInOIDC(LinkedInOIDC):
    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self.claims = LinkedInIdentityClaims(
            sub="linkedin-subject-1",
            name="Example User",
            given_name="Example",
            email="person@example.test",
            email_verified=True,
        )
        self.validation_error: str | None = None
        self.nonces: list[str] = []

    async def exchange_code(self, code: str) -> str:
        assert code == "mock-code"
        return "mock-id-token"

    async def validate_id_token(self, id_token: str) -> LinkedInIdentityClaims:
        assert id_token == "mock-id-token"
        if self.validation_error:
            raise OIDCError(self.validation_error)
        return self.claims


class FakeSupabaseLinkedInOIDC(SupabaseLinkedInOIDC):
    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self.claims = LinkedInIdentityClaims(
            sub="linkedin-subject-1",
            name="Example User",
            email="person@example.test",
            email_verified=True,
        )
        self.validation_error: str | None = None
        self.nonces: list[str] = []
        self.verifiers: list[str] = []

    def authorization_url(self, state: str, nonce: str) -> str:
        self.nonces.append(nonce)
        return super().authorization_url(state, nonce)

    def expected_verifier(self, location: str) -> str:
        assert "code_challenge=" in location
        return self.nonces[-1]

    async def exchange_code(self, code: str, code_verifier: str) -> LinkedInIdentityClaims:
        assert code == "supabase-code"
        self.verifiers.append(code_verifier)
        if self.validation_error:
            raise OIDCError(self.validation_error)
        return self.claims


logging.getLogger("httpx").setLevel(logging.WARNING)


def make_test_settings(*, configured: bool = True, supabase: bool = False) -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        database_url=os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:"),
        auth_hash_pepper=TEST_PEPPER,
        frontend_url="http://localhost:8080",
        cors_origins="http://localhost:8080",
        cookie_secure=False,
        linkedin_client_id="test-client" if configured and not supabase else None,
        linkedin_client_secret="test-secret" if configured and not supabase else None,
        linkedin_redirect_uri="http://localhost:8000/api/v1/auth/linkedin/callback",
        supabase_url="https://existing-project.supabase.co" if supabase else None,
        supabase_publishable_key="test-supabase-publishable-key" if supabase else None,
    )


async def build_client(
    *, configured: bool = True, supabase: bool = False
) -> AsyncIterator[tuple[AsyncClient, object]]:
    settings = make_test_settings(configured=configured, supabase=supabase)
    app = create_app(settings)
    app.state.oidc = FakeLinkedInOIDC(settings)
    app.state.supabase = FakeSupabaseLinkedInOIDC(settings)
    async with app.state.engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
        follow_redirects=False,
    ) as client:
        yield client, app
    async with app.state.engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
    await app.state.engine.dispose()


@pytest.fixture
async def client_app() -> AsyncIterator[tuple[AsyncClient, object]]:
    async for client, app in build_client():
        yield client, app


@pytest.fixture
async def unconfigured_client_app() -> AsyncIterator[tuple[AsyncClient, object]]:
    async for client, app in build_client(configured=False):
        yield client, app


@pytest.fixture
async def supabase_client_app() -> AsyncIterator[tuple[AsyncClient, object]]:
    async for client, app in build_client(supabase=True):
        yield client, app


async def start_authorize(client: AsyncClient) -> tuple[str, Response]:
    response = await client.get("/api/v1/auth/linkedin/authorize")
    assert response.status_code == 302
    state = parse_qs(urlparse(response.headers["location"]).query)["state"][0]
    return state, response


async def complete_login(
    client: AsyncClient,
    app: object,
    claims: LinkedInIdentityClaims | None = None,
) -> Response:
    fake = app.state.oidc  # type: ignore[attr-defined]
    if claims is not None:
        fake.claims = claims
    state, _ = await start_authorize(client)
    response = await client.get(
        "/api/v1/auth/linkedin/callback",
        params={"code": "mock-code", "state": state},
    )
    assert response.status_code == 303
    return response


async def bootstrap(client: AsyncClient) -> dict[str, object]:
    response = await client.get("/api/v1/auth/session")
    assert response.status_code == 200
    return response.json()


def mutation_headers(workspace: dict[str, object]) -> dict[str, str]:
    return {
        "Origin": "http://localhost:8080",
        "X-CSRF-Token": str(workspace["csrf_token"]),
    }
import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import func, select

from app.config import Settings
from app.models import ExternalIdentity, User
from app.oidc import OIDCError
from app.schemas import LinkedInIdentityClaims
from app.supabase_auth import SupabaseLinkedInOIDC
from tests.conftest import bootstrap, make_test_settings


async def test_supabase_authorize_uses_linkedin_oidc_and_pkce(supabase_client_app) -> None:
    client, _ = supabase_client_app
    response = await client.get("/api/v1/auth/linkedin/authorize")
    assert response.status_code == 302
    location = urlparse(response.headers["location"])
    query = parse_qs(location.query)
    assert location.scheme == "https"
    assert location.netloc == "existing-project.supabase.co"
    assert location.path == "/auth/v1/authorize"
    assert query["provider"] == ["linkedin_oidc"]
    assert query["scopes"] == ["openid profile email"]
    assert query["redirect_to"] == ["http://localhost:8000/api/v1/auth/linkedin/callback"]
    assert query["code_challenge_method"] == ["s256"]
    assert len(query["code_challenge"][0]) == 43
    assert "state" not in query  # Supabase owns its provider-facing flow state.
    assert "client_secret" not in query


async def test_supabase_callback_creates_session_and_maps_profile(supabase_client_app) -> None:
    client, app = supabase_client_app
    app.state.supabase.claims = LinkedInIdentityClaims(
        sub="linkedin-person-42",
        name="Amara Example",
        given_name="Amara",
        family_name="Example",
        picture="https://media.example.test/profile.jpg",
        email="amara@example.test",
        email_verified=True,
        locale="en_US",
    )
    authorize = await client.get("/api/v1/auth/linkedin/authorize")
    verifier = app.state.supabase.expected_verifier(authorize.headers["location"])
    callback = await client.get(
        "/api/v1/auth/linkedin/callback",
        params={"code": "supabase-code", "state": "supabase-owned-flow-state"},
    )
    assert callback.status_code == 303
    assert callback.headers["location"].endswith("/coach?auth=linkedin&first_login=1")
    assert app.state.supabase.verifiers == [verifier]
    workspace = await bootstrap(client)
    assert workspace["identity"] == {
        "sub": "linkedin-person-42",
        "name": "Amara Example",
        "given_name": "Amara",
        "family_name": "Example",
        "picture": "https://media.example.test/profile.jpg",
        "email": "amara@example.test",
        "email_verified": True,
        "locale": "en_US",
    }
    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count(User.id))) == 1
        identity = await db.scalar(select(ExternalIdentity))
        assert identity.provider == "linkedin"
        assert identity.provider_subject == "linkedin-person-42"


async def test_supabase_cancellation_and_provider_failure_are_visible(
    supabase_client_app,
) -> None:
    client, app = supabase_client_app
    await client.get("/api/v1/auth/linkedin/authorize")
    cancelled = await client.get(
        "/api/v1/auth/linkedin/callback", params={"error": "access_denied"}
    )
    assert cancelled.status_code == 303
    assert cancelled.headers["location"].endswith("/?auth_error=access_denied")

    app.state.supabase.validation_error = "oauth_validation_failed"
    await client.get("/api/v1/auth/linkedin/authorize")
    failed = await client.get(
        "/api/v1/auth/linkedin/callback",
        params={"code": "supabase-code", "state": "supabase-owned-flow-state"},
    )
    assert failed.headers["location"].endswith("/?auth_error=oauth_validation_failed")
    assert failed.cookies.get("hnt_session") is None


async def test_supabase_callback_requires_signed_attempt_cookie(supabase_client_app) -> None:
    client, _ = supabase_client_app
    await client.get("/api/v1/auth/linkedin/authorize")
    client.cookies.delete("hnt_oauth", path="/api/v1/auth/linkedin")
    response = await client.get(
        "/api/v1/auth/linkedin/callback",
        params={"code": "supabase-code", "state": "supabase-owned-flow-state"},
    )
    assert response.headers["location"].endswith("/?auth_error=invalid_state")


def test_supabase_profile_mapping_uses_available_identity_fields() -> None:
    settings = make_test_settings(supabase=True)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["apikey"] == "test-supabase-publishable-key"
        if request.url.path == "/auth/v1/token":
            assert request.content
            return httpx.Response(200, json={"access_token": "not-a-real-token"})
        assert request.url.path == "/auth/v1/user"
        assert request.headers["Authorization"] == "Bearer not-a-real-token"
        return httpx.Response(
            200,
            json={
                "id": "supabase-user-id",
                "email": "person@example.test",
                "email_confirmed_at": "2026-11-22T06:00:00Z",
                "user_metadata": {"full_name": "Metadata Name", "avatar_url": "old"},
                "identities": [
                    {
                        "provider": "linkedin_oidc",
                        "identity_data": {
                            "sub": "linkedin-stable-subject",
                            "name": "LinkedIn Name",
                            "given_name": "LinkedIn",
                            "family_name": "Name",
                            "picture": "https://media.example.test/new.jpg",
                            "locale": "de_DE",
                        },
                    }
                ],
            },
        )

    provider = SupabaseLinkedInOIDC(settings, transport=httpx.MockTransport(handler))
    import asyncio

    claims = asyncio.run(provider.exchange_code("auth-code", "pkce-verifier"))
    assert claims.sub == "linkedin-stable-subject"
    assert claims.name == "LinkedIn Name"
    assert claims.picture == "https://media.example.test/new.jpg"
    assert claims.email == "person@example.test"
    assert claims.email_verified is True
    assert claims.locale == "de_DE"


def test_supabase_pkce_challenge_matches_verifier() -> None:
    settings = make_test_settings(supabase=True)
    provider = SupabaseLinkedInOIDC(settings)
    verifier = "a" * 43
    location = provider.authorization_url("ignored-local-state", verifier)
    actual = parse_qs(urlparse(location).query)["code_challenge"][0]
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    assert actual == expected


def test_supabase_rejects_missing_access_token() -> None:
    settings = make_test_settings(supabase=True)
    provider = SupabaseLinkedInOIDC(
        settings, transport=httpx.MockTransport(lambda _: httpx.Response(200, json={}))
    )
    import asyncio

    with pytest.raises(OIDCError):
        asyncio.run(provider.exchange_code("auth-code", "pkce-verifier"))


def test_partial_supabase_configuration_fails_closed() -> None:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url="https://existing-project.supabase.co",
        supabase_publishable_key=None,
    )
    assert settings.oauth_configured is False
    assert settings.missing_oauth_configuration == ["SUPABASE_PUBLISHABLE_KEY"]
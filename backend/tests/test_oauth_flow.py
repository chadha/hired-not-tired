from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from fastapi import Response
from sqlalchemy import func, select

from app.database import utcnow
from app.models import (
    AuthSession,
    CareerProfile,
    ConsentRecord,
    ExternalIdentity,
    OAuthAttempt,
    User,
)
from app.schemas import LinkedInIdentityClaims
from app.security import set_oauth_cookie
from tests.conftest import (
    bootstrap,
    complete_login,
    make_test_settings,
    start_authorize,
)


def test_secure_oauth_cookie_uses_secure_prefix_with_narrow_path() -> None:
    settings = make_test_settings().model_copy(update={"cookie_secure": True})
    assert settings.oauth_cookie_name == "__Secure-hnt_oauth"

    response = Response()
    set_oauth_cookie(response, "opaque-attempt", settings)
    cookie = response.headers["set-cookie"]
    assert "__Secure-hnt_oauth=opaque-attempt" in cookie
    assert "Path=/api/v1/auth/linkedin" in cookie
    assert "Secure" in cookie
    assert "Domain=" not in cookie


async def test_first_login_provisions_identity_profile_and_required_notices(client_app) -> None:
    client, app = client_app
    fake = app.state.oidc
    fake.claims = LinkedInIdentityClaims(sub="subject-no-email", name="No Email")

    state, authorize = await start_authorize(client)
    query = parse_qs(urlparse(authorize.headers["location"]).query)
    assert query["scope"] == ["openid profile email"]
    assert query["redirect_uri"] == ["http://localhost:8000/api/v1/auth/linkedin/callback"]
    assert query["state"] == [state]
    # LinkedIn does not include a nonce claim in its documented ID-token profile.
    # The one-time state and signed attempt cookie bind the browser callback instead.
    assert "nonce" not in query
    assert "client_secret" not in query
    oauth_cookie = authorize.headers["set-cookie"]
    assert "HttpOnly" in oauth_cookie
    assert "SameSite=lax" in oauth_cookie

    callback = await client.get(
        "/api/v1/auth/linkedin/callback", params={"code": "mock-code", "state": state}
    )
    assert callback.status_code == 303
    assert callback.headers["location"].endswith("/coach?auth=linkedin&first_login=1")
    assert "hnt_session=" in callback.headers["set-cookie"]
    assert "HttpOnly" in callback.headers["set-cookie"]

    workspace = await bootstrap(client)
    assert workspace["first_login"] is True
    assert workspace["career_profile_created"] is True
    assert workspace["identity"]["sub"] == "subject-no-email"
    assert workspace["identity"]["email"] is None
    assert workspace["identity"]["email_verified"] is False
    assert {item["notice_type"] for item in workspace["consents"]} == {"service_terms", "privacy"}

    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count(User.id))) == 1
        assert await db.scalar(select(func.count(ExternalIdentity.id))) == 1
        assert await db.scalar(select(func.count(CareerProfile.id))) == 1
        assert await db.scalar(select(func.count(ConsentRecord.id))) == 2
        stored_session = await db.scalar(select(AuthSession))
        assert callback.cookies.get("hnt_session")
        assert stored_session.token_hash != callback.cookies.get("hnt_session")
        assert len(stored_session.token_hash) == 64


async def test_returning_login_reuses_subject_not_email(client_app) -> None:
    client, app = client_app
    await complete_login(client, app)
    second = await complete_login(client, app)
    assert second.headers["location"].endswith("/coach?auth=linkedin&first_login=0")
    workspace = await bootstrap(client)
    assert workspace["first_login"] is False
    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count(User.id))) == 1


async def test_same_email_with_different_subject_never_merges_accounts(client_app) -> None:
    client, app = client_app
    await complete_login(client, app)
    await complete_login(
        client,
        app,
        LinkedInIdentityClaims(sub="different-subject", email="person@example.test"),
    )
    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count(User.id))) == 2


async def test_provider_denial_and_invalid_state_create_no_account(client_app) -> None:
    client, app = client_app
    state, _ = await start_authorize(client)
    denied = await client.get(
        "/api/v1/auth/linkedin/callback",
        params={
            "error": "access_denied",
            "error_description": "private provider detail",
            "state": state,
        },
    )
    assert denied.status_code == 303
    assert denied.headers["location"].endswith("/?auth_error=access_denied")
    assert "private" not in denied.headers["location"]

    invalid = await client.get(
        "/api/v1/auth/linkedin/callback", params={"code": "mock-code", "state": "wrong"}
    )
    assert invalid.status_code == 303
    assert invalid.headers["location"].endswith("/?auth_error=invalid_state")
    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count(User.id))) == 0


async def test_invalid_oidc_token_and_expired_attempt_fail_safely(client_app) -> None:
    client, app = client_app
    app.state.oidc.validation_error = "oauth_validation_failed"
    state, _ = await start_authorize(client)
    rejected = await client.get(
        "/api/v1/auth/linkedin/callback", params={"code": "mock-code", "state": state}
    )
    assert rejected.status_code == 303
    assert rejected.headers["location"].endswith("/?auth_error=oauth_validation_failed")

    app.state.oidc.validation_error = None
    state, _ = await start_authorize(client)
    async with app.state.session_factory() as db:
        attempt = await db.scalar(
            select(OAuthAttempt).order_by(OAuthAttempt.created_at.desc()).limit(1)
        )
        attempt.expires_at = utcnow() - timedelta(seconds=1)
        await db.commit()
    expired = await client.get(
        "/api/v1/auth/linkedin/callback", params={"code": "mock-code", "state": state}
    )
    assert expired.headers["location"].endswith("/?auth_error=invalid_state")


async def test_state_is_single_use_and_attempt_cookie_is_required(client_app) -> None:
    client, app = client_app
    state, _ = await start_authorize(client)
    callback = await client.get(
        "/api/v1/auth/linkedin/callback", params={"code": "mock-code", "state": state}
    )
    assert callback.status_code == 303

    replay_client, replay_app = client, app
    replay_client.cookies.delete("hnt_session")
    replay = await replay_client.get(
        "/api/v1/auth/linkedin/callback", params={"code": "mock-code", "state": state}
    )
    assert replay.headers["location"].endswith("/?auth_error=invalid_state")

    state, _ = await start_authorize(client)
    client.cookies.delete("hnt_oauth", path="/api/v1/auth/linkedin")
    missing_cookie = await client.get(
        "/api/v1/auth/linkedin/callback", params={"code": "mock-code", "state": state}
    )
    assert missing_cookie.headers["location"].endswith("/?auth_error=invalid_state")
    assert replay_app.state.oidc is not None
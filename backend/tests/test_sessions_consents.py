from datetime import timedelta

from sqlalchemy import select

from app.database import utcnow
from app.models import AuthSession
from tests.conftest import bootstrap, complete_login, mutation_headers


async def test_auth_required_routes_reject_anonymous_requests(client_app) -> None:
    client, _ = client_app
    assert (await client.get("/api/v1/auth/session")).status_code == 401
    assert (await client.post("/api/v1/auth/logout")).status_code == 401
    assert (
        await client.put(
            "/api/v1/account/consents",
            json={
                "consents": [
                    {"notice_type": "marketing", "notice_version": "2026-11-22", "granted": True}
                ]
            },
        )
    ).status_code == 401
    assert (
        await client.request("DELETE", "/api/v1/account", json={"confirmation": "DELETE"})
    ).status_code == 401


async def test_consent_validation_granularity_history_and_withdrawal(client_app) -> None:
    client, app = client_app
    await complete_login(client, app)
    workspace = await bootstrap(client)
    headers = mutation_headers(workspace)

    missing_origin = await client.put(
        "/api/v1/account/consents",
        headers={"X-CSRF-Token": headers["X-CSRF-Token"]},
        json={
            "consents": [
                {"notice_type": "marketing", "notice_version": "2026-11-22", "granted": True}
            ]
        },
    )
    assert missing_origin.status_code == 403
    assert missing_origin.json()["error"]["code"] == "csrf_origin_required"

    missing_token = await client.put(
        "/api/v1/account/consents",
        headers={"Origin": "http://localhost:8080"},
        json={
            "consents": [
                {"notice_type": "marketing", "notice_version": "2026-11-22", "granted": True}
            ]
        },
    )
    assert missing_token.json()["error"]["code"] == "csrf_token_required"

    invalid_token = await client.put(
        "/api/v1/account/consents",
        headers={"Origin": "http://localhost:8080", "X-CSRF-Token": "wrong"},
        json={
            "consents": [
                {"notice_type": "marketing", "notice_version": "2026-11-22", "granted": True}
            ]
        },
    )
    assert invalid_token.json()["error"]["code"] == "csrf_token_invalid"

    payload = {
        "consents": [
            {"notice_type": "marketing", "notice_version": "2026-11-22", "granted": True},
            {"notice_type": "research", "notice_version": "2026-11-22", "granted": True},
        ]
    }
    granted = await client.put("/api/v1/account/consents", headers=headers, json=payload)
    assert granted.status_code == 200
    states = {item["notice_type"]: item["granted"] for item in granted.json()["consents"]}
    assert states["marketing"] is True
    assert states["research"] is True
    assert all(item["recorded_at"] for item in granted.json()["consents"])
    assert states["service_terms"] is True

    withdrawn = await client.put(
        "/api/v1/account/consents",
        headers=headers,
        json={
            "consents": [
                {"notice_type": "marketing", "notice_version": "2026-11-22", "granted": False}
            ]
        },
    )
    assert withdrawn.status_code == 200
    states = {item["notice_type"]: item["granted"] for item in withdrawn.json()["consents"]}
    assert states["marketing"] is False
    assert states["research"] is True

    wrong_version = await client.put(
        "/api/v1/account/consents",
        headers=headers,
        json={"consents": [{"notice_type": "marketing", "notice_version": "old", "granted": True}]},
    )
    assert wrong_version.json()["error"]["code"] == "consent_version_invalid"

    duplicate = await client.put(
        "/api/v1/account/consents",
        headers=headers,
        json={
            "consents": [
                {"notice_type": "marketing", "notice_version": "2026-11-22", "granted": True},
                {"notice_type": "marketing", "notice_version": "2026-11-22", "granted": False},
            ]
        },
    )
    assert duplicate.json()["error"]["code"] == "duplicate_notice_type"

    essential = await client.put(
        "/api/v1/account/consents",
        headers=headers,
        json={
            "consents": [
                {"notice_type": "privacy", "notice_version": "2026-11-22", "granted": False}
            ]
        },
    )
    assert essential.json()["error"]["code"] == "essential_consent_required"

    async with app.state.session_factory() as db:
        sessions = (await db.execute(select(AuthSession))).scalars().all()
        assert len(sessions) == 1


async def test_session_bootstrap_rotates_csrf_and_logout_revokes_session(client_app) -> None:
    client, app = client_app
    await complete_login(client, app)
    first = await bootstrap(client)
    second = await bootstrap(client)
    assert first["csrf_token"] != second["csrf_token"]

    old_csrf = await client.post("/api/v1/auth/logout", headers=mutation_headers(first))
    assert old_csrf.status_code == 403
    response = await client.post("/api/v1/auth/logout", headers=mutation_headers(second))
    assert response.status_code == 204
    assert response.content == b""
    assert (await client.get("/api/v1/auth/session")).status_code == 401
    async with app.state.session_factory() as db:
        session = await db.scalar(select(AuthSession))
        assert session.revoked_at is not None


async def test_expired_session_is_rejected(client_app) -> None:
    client, app = client_app
    await complete_login(client, app)
    async with app.state.session_factory() as db:
        session = await db.scalar(select(AuthSession))
        session.expires_at = utcnow() - timedelta(seconds=1)
        await db.commit()
    assert (await client.get("/api/v1/auth/session")).status_code == 401

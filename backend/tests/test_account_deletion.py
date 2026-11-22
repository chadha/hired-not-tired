from sqlalchemy import func, select

from app.models import CareerProfile, ConsentRecord, ExternalIdentity, OAuthAttempt, User
from tests.conftest import bootstrap, complete_login, mutation_headers


async def test_account_deletion_requires_exact_confirmation(client_app) -> None:
    client, app = client_app
    await complete_login(client, app)
    workspace = await bootstrap(client)
    response = await client.request(
        "DELETE",
        "/api/v1/account",
        headers=mutation_headers(workspace),
        json={"confirmation": "yes"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "deletion_confirmation_required"
    assert (await client.get("/api/v1/auth/session")).status_code == 200


async def test_account_deletion_closes_anonymizes_and_revokes(client_app) -> None:
    client, app = client_app
    await complete_login(client, app)
    await complete_login(client, app)
    workspace = await bootstrap(client)
    response = await client.request(
        "DELETE",
        "/api/v1/account",
        headers=mutation_headers(workspace),
        json={"confirmation": "DELETE"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "closed_and_anonymized"
    assert body["sessions_revoked"] == 2
    assert body["active_profile_deleted"] is True
    assert body["external_identity_deleted"] is True
    assert "30 days" in body["retention_notice"]
    assert (await client.get("/api/v1/auth/session")).status_code == 401

    async with app.state.session_factory() as db:
        user = await db.scalar(select(User))
        assert user.status == "closed"
        assert user.email is None
        assert user.full_name is None
        assert user.closed_at is not None
        assert await db.scalar(select(func.count(CareerProfile.id))) == 0
        assert await db.scalar(select(func.count(ExternalIdentity.id))) == 0
        assert await db.scalar(select(func.count(OAuthAttempt.id))) == 0
        assert await db.scalar(select(func.count(ConsentRecord.id))) == 2


async def test_legal_hold_blocks_self_service_deletion(client_app) -> None:
    client, app = client_app
    await complete_login(client, app)
    workspace = await bootstrap(client)
    async with app.state.session_factory() as db:
        user = await db.scalar(select(User))
        user.legal_hold = True
        await db.commit()
    response = await client.request(
        "DELETE",
        "/api/v1/account",
        headers=mutation_headers(workspace),
        json={"confirmation": "DELETE"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_legal_hold"
    assert (await client.get("/api/v1/auth/session")).status_code == 200
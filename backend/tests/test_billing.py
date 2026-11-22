from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.config import Settings
from app.database import Base
from app.main import create_app
from app.models import PaymentTransaction, ProcessedPaypalWebhook
from tests.conftest import (
    FakeLinkedInOIDC,
    bootstrap,
    complete_login,
    make_test_settings,
    mutation_headers,
)


class FakePayPal:
    def __init__(self) -> None:
        self.custom_id = ""
        self.status = "ACTIVE"
        self.plan_id = "P-PRO"
        self.amount = "9.99"
        self.currency = "EUR"
        self.interval_unit = "MONTH"
        self.interval_count = 1
        self.signature_valid = True
        self.cancel_calls: list[str] = []

    async def get_subscription(self, subscription_id: str):
        return {
            "id": subscription_id,
            "plan_id": self.plan_id,
            "custom_id": self.custom_id,
            "status": self.status,
            "start_time": "2026-11-22T07:00:00Z",
            "billing_info": {"next_billing_time": "2026-12-22T07:00:00Z"},
        }

    async def get_plan(self, plan_id: str):
        assert plan_id == self.plan_id
        return {
            "billing_cycles": [
                {
                    "tenure_type": "REGULAR",
                    "sequence": 1,
                    "frequency": {
                        "interval_unit": self.interval_unit,
                        "interval_count": self.interval_count,
                    },
                    "pricing_scheme": {
                        "fixed_price": {"currency_code": self.currency, "value": self.amount}
                    },
                }
            ]
        }

    async def cancel_subscription(self, subscription_id: str, reason: str) -> None:
        self.cancel_calls.append(subscription_id)
        assert reason
        self.status = "CANCELLED"

    async def verify_webhook_signature(self, *, event, headers) -> bool:
        assert event["id"]
        assert headers["paypal-transmission-id"]
        return self.signature_valid


def configure(settings: Settings) -> None:
    settings.paypal_client_id = "sandbox-client"
    settings.paypal_client_secret = "sandbox-secret"
    settings.paypal_webhook_id = "WH-test"
    settings.paypal_starter_plan_id = "P-STARTER"
    settings.paypal_pro_plan_id = "P-PRO"
    settings.paypal_premium_plan_id = "P-PREMIUM"


@asynccontextmanager
async def billing_client(*, configured: bool = True):
    settings = make_test_settings()
    if configured:
        configure(settings)
    app = create_app(settings)
    app.state.oidc = FakeLinkedInOIDC(settings)
    fake = FakePayPal()
    app.state.paypal = fake
    async with app.state.engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver", follow_redirects=False
    ) as client:
        yield client, app, fake
    async with app.state.engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
    await app.state.engine.dispose()


def headers(workspace: dict[str, object]) -> dict[str, str]:
    return {**mutation_headers(workspace), "Idempotency-Key": str(uuid4())}


async def login(client: AsyncClient, app, subject: str = "billing-user") -> dict[str, object]:
    from app.schemas import LinkedInIdentityClaims

    app.state.oidc.claims = LinkedInIdentityClaims(
        sub=subject, name="Billing User", email="billing@example.test", email_verified=True
    )
    await complete_login(client, app)
    return await bootstrap(client)


async def create_intent(
    client: AsyncClient, workspace: dict[str, object], plan: str = "pro"
) -> str:
    response = await client.post(
        "/api/v1/billing/checkout-intents", headers=headers(workspace), json={"plan_key": plan}
    )
    assert response.status_code == 200, response.text
    return response.json()["intent_id"]


async def verify(
    client: AsyncClient,
    workspace: dict[str, object],
    intent_id: str,
    subscription_id: str = "I-TEST",
):
    return await client.post(
        "/api/v1/billing/verify",
        headers=headers(workspace),
        json={"intent_id": intent_id, "subscription_id": subscription_id},
    )


async def activate(client: AsyncClient, app, fake: FakePayPal, workspace: dict[str, object]) -> str:
    intent_id = await create_intent(client, workspace)
    fake.custom_id = intent_id
    response = await verify(client, workspace, intent_id)
    assert response.status_code == 200, response.text
    assert response.json()["verified"] is True
    return intent_id


def webhook_headers() -> dict[str, str]:
    return {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert.pem",
        "paypal-transmission-id": "transmission-test",
        "paypal-transmission-sig": "signature-test",
        "paypal-transmission-time": "2026-11-22T07:00:00Z",
    }


@pytest.mark.parametrize(
    ("key", "amount", "recommended"),
    [("starter", "4.99", False), ("pro", "9.99", True), ("premium", "19.99", False)],
)
async def test_plan_mapping(key: str, amount: str, recommended: bool) -> None:
    async with billing_client() as (client, app, _):
        await login(client, app)
        response = await client.get("/api/v1/billing/plans")
        plan = next(item for item in response.json()["plans"] if item["key"] == key)
        assert plan["amount"] == amount
        assert plan["currency"] == "EUR"
        assert plan["interval_unit"] == "MONTH"
        assert plan["interval_count"] == 1
        assert plan["recommended"] is recommended
        assert plan["configured"] is True


async def test_missing_credentials_and_live_fail_closed() -> None:
    with pytest.raises(ValueError, match="PAYPAL_LIVE_ENABLED"):
        Settings(_env_file=None, app_env="test", paypal_env="live")
    async with billing_client(configured=False) as (client, app, _):
        workspace = await login(client, app)
        plans = await client.get("/api/v1/billing/plans")
        assert all(plan["configured"] is False for plan in plans.json()["plans"])
        checkout = await client.post(
            "/api/v1/billing/checkout-intents", headers=headers(workspace), json={"plan_key": "pro"}
        )
        assert checkout.status_code == 503
        status = await client.get("/api/v1/billing/subscription")
        assert status.json()["entitlement_active"] is False


async def test_active_subscription_requires_matching_pending_intent_and_exact_plan() -> None:
    async with billing_client() as (client, app, fake):
        workspace = await login(client, app)
        await activate(client, app, fake, workspace)
        current = await client.get("/api/v1/billing/subscription")
        assert current.json()["entitlement_active"] is True
        assert current.json()["entitlement_plan"] == "pro"
        assert current.json()["amount"] == "9.99"
        assert current.json()["currency"] == "EUR"


async def test_plan_amount_mismatch_and_inactive_subscription_never_grant_access() -> None:
    async with billing_client() as (client, app, fake):
        workspace = await login(client, app)
        intent_id = await create_intent(client, workspace)
        fake.custom_id = intent_id
        fake.amount = "10.00"
        mismatch = await verify(client, workspace, intent_id, "I-MISMATCH")
        assert mismatch.status_code == 422
        fake.amount = "9.99"
        fake.status = "APPROVAL_PENDING"
        pending = await verify(client, workspace, intent_id, "I-PENDING")
        assert pending.status_code == 200
        assert pending.json()["verified"] is False
        assert pending.json()["subscription"]["entitlement_active"] is False


async def test_another_users_subscription_cannot_be_claimed_or_cancelled() -> None:
    async with billing_client() as (client, app, fake):
        first = await login(client, app, "first-billing-user")
        await activate(client, app, fake, first)
        second = await login(client, app, "second-billing-user")
        second_intent = await create_intent(client, second)
        fake.custom_id = second_intent
        claimed = await verify(client, second, second_intent, "I-TEST")
        assert claimed.status_code == 409
        cancelled = await client.post(
            "/api/v1/billing/cancellation",
            headers=headers(second),
            json={"subscription_id": "I-TEST"},
        )
        assert cancelled.status_code == 404
        assert fake.cancel_calls == []


async def test_cancellation_preserves_confirmed_paid_through_access() -> None:
    async with billing_client() as (client, app, fake):
        workspace = await login(client, app)
        await activate(client, app, fake, workspace)
        response = await client.post(
            "/api/v1/billing/cancellation",
            headers=headers(workspace),
            json={"subscription_id": "I-TEST"},
        )
        assert response.status_code == 200, response.text
        subscription = response.json()["subscription"]
        assert subscription["status"] == "CANCELLED"
        assert subscription["entitlement_active"] is True
        assert subscription["paid_through"].startswith("2026-12-22T07:00:00")
        assert fake.cancel_calls == ["I-TEST"]


async def test_signed_subscription_webhook_is_idempotent_and_invalid_signature_is_rejected() -> (
    None
):
    async with billing_client() as (client, app, fake):
        workspace = await login(client, app)
        await activate(client, app, fake, workspace)
        event = {
            "id": "WH-EVENT-1",
            "event_type": "BILLING.SUBSCRIPTION.UPDATED",
            "resource": {"id": "I-TEST"},
        }
        first = await client.post("/api/v1/webhooks/paypal", json=event, headers=webhook_headers())
        assert first.status_code == 200
        assert first.json()["status"] == "processed"
        duplicate = await client.post(
            "/api/v1/webhooks/paypal", json=event, headers=webhook_headers()
        )
        assert duplicate.json()["status"] == "duplicate"
        fake.signature_valid = False
        invalid = await client.post(
            "/api/v1/webhooks/paypal",
            json={**event, "id": "WH-EVENT-2"},
            headers=webhook_headers(),
        )
        assert invalid.status_code == 400
        async with app.state.session_factory() as db:
            count = await db.scalar(select(func.count()).select_from(ProcessedPaypalWebhook))
            assert count == 1


async def test_completed_refunded_and_reversed_payments_are_recorded() -> None:
    async with billing_client() as (client, app, fake):
        workspace = await login(client, app)
        await activate(client, app, fake, workspace)
        completed = {
            "id": "WH-PAY-1",
            "event_type": "PAYMENT.SALE.COMPLETED",
            "resource": {
                "id": "SALE-1",
                "billing_agreement_id": "I-TEST",
                "amount": {"total": "9.99", "currency": "EUR"},
                "create_time": "2026-11-22T07:00:00Z",
            },
        }
        refunded = {
            "id": "WH-PAY-2",
            "event_type": "PAYMENT.SALE.REFUNDED",
            "resource": {
                "id": "REFUND-1",
                "sale_id": "SALE-1",
                "billing_agreement_id": "I-TEST",
                "amount": {"total": "9.99", "currency": "EUR"},
            },
        }
        reversed_event = {
            "id": "WH-PAY-3",
            "event_type": "PAYMENT.SALE.REVERSED",
            "resource": {**refunded["resource"], "id": "REVERSAL-1"},
        }
        for event in (completed, refunded, reversed_event):
            response = await client.post(
                "/api/v1/webhooks/paypal", json=event, headers=webhook_headers()
            )
            assert response.status_code == 200, response.text
        async with app.state.session_factory() as db:
            records = (await db.scalars(select(PaymentTransaction))).all()
            assert len(records) == 3
            original = next(
                record for record in records if record.paypal_transaction_id == "SALE-1"
            )
            assert original.status == "REVERSED"
            assert {record.status for record in records} == {"REVERSED", "REFUNDED"}

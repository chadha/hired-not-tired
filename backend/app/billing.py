from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

import httpx

from app.config import Settings
from app.errors import ApiError

PlanKey = Literal["starter", "pro", "premium"]
JsonDict = dict[str, Any]


@dataclass(frozen=True)
class PlanDefinition:
    key: PlanKey
    name: str
    amount: Decimal
    currency: str
    interval_unit: str
    interval_count: int
    paypal_plan_id: str | None
    recommended: bool


def plan_definitions(settings: Settings) -> tuple[PlanDefinition, ...]:
    return (
        PlanDefinition(
            "starter",
            "Starter",
            Decimal("4.99"),
            "EUR",
            "MONTH",
            1,
            settings.paypal_starter_plan_id,
            False,
        ),
        PlanDefinition(
            "pro", "Pro", Decimal("9.99"), "EUR", "MONTH", 1, settings.paypal_pro_plan_id, True
        ),
        PlanDefinition(
            "premium",
            "Premium",
            Decimal("19.99"),
            "EUR",
            "MONTH",
            1,
            settings.paypal_premium_plan_id,
            False,
        ),
    )


def find_plan(settings: Settings, key: str) -> PlanDefinition | None:
    return next((plan for plan in plan_definitions(settings) if plan.key == key), None)


class PayPalClient:
    """Small server-only Subscriptions client. No access token is logged or persisted."""

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.settings = settings
        self.transport = transport
        self.base_url = (
            "https://api-m.sandbox.paypal.com"
            if settings.paypal_env == "sandbox"
            else "https://api-m.paypal.com"
        )

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.outbound_timeout_seconds),
            transport=self.transport,
            follow_redirects=False,
        )

    async def _access_token(self) -> str:
        if not self.settings.paypal_client_id or not self.settings.paypal_client_secret:
            raise ApiError(503, "paypal_not_configured", "Sandbox checkout not configured yet.")
        async with self._client() as client:
            response = await client.post(
                f"{self.base_url}/v1/oauth2/token",
                auth=(self.settings.paypal_client_id, self.settings.paypal_client_secret),
                data={"grant_type": "client_credentials"},
                headers={"Accept": "application/json"},
            )
        if response.status_code != 200:
            raise ApiError(503, "paypal_unavailable", "PayPal Sandbox is temporarily unavailable.")
        token = response.json().get("access_token")
        if not isinstance(token, str) or not token:
            raise ApiError(
                503, "paypal_unavailable", "PayPal Sandbox returned an invalid token response."
            )
        return token

    async def _request(self, method: str, path: str, **kwargs: Any) -> JsonDict:
        token = await self._access_token()
        async with self._client() as client:
            response = await client.request(
                method,
                f"{self.base_url}{path}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                **kwargs,
            )
        if response.status_code >= 400:
            raise ApiError(
                503 if response.status_code >= 500 or response.status_code == 429 else 422,
                "paypal_request_failed",
                "PayPal could not complete the subscription operation. No entitlement was changed.",
            )
        if response.status_code == 204 or not response.content:
            return {}
        parsed = response.json()
        if not isinstance(parsed, dict):
            raise ApiError(503, "paypal_invalid_response", "PayPal returned an invalid response.")
        return parsed

    async def get_subscription(self, subscription_id: str) -> JsonDict:
        return await self._request("GET", f"/v1/billing/subscriptions/{subscription_id}")

    async def get_plan(self, plan_id: str) -> JsonDict:
        return await self._request("GET", f"/v1/billing/plans/{plan_id}")

    async def cancel_subscription(self, subscription_id: str, reason: str) -> None:
        await self._request(
            "POST",
            f"/v1/billing/subscriptions/{subscription_id}/cancel",
            json={"reason": reason},
        )

    async def verify_webhook_signature(
        self,
        *,
        event: JsonDict,
        headers: dict[str, str | None],
    ) -> bool:
        if not self.settings.paypal_webhook_id:
            raise ApiError(
                503, "paypal_webhook_not_configured", "PayPal webhooks are not configured."
            )
        required = {
            "auth_algo": headers.get("paypal-auth-algo"),
            "cert_url": headers.get("paypal-cert-url"),
            "transmission_id": headers.get("paypal-transmission-id"),
            "transmission_sig": headers.get("paypal-transmission-sig"),
            "transmission_time": headers.get("paypal-transmission-time"),
        }
        if any(not value for value in required.values()):
            return False
        result = await self._request(
            "POST",
            "/v1/notifications/verify-webhook-signature",
            json={
                **required,
                "webhook_id": self.settings.paypal_webhook_id,
                "webhook_event": event,
            },
        )
        return result.get("verification_status") == "SUCCESS"


def verify_remote_plan(remote: JsonDict, expected: PlanDefinition) -> None:
    """Check the server-side PayPal plan, never browser-supplied amount/currency."""

    cycles = remote.get("billing_cycles")
    if not isinstance(cycles, list):
        raise ApiError(
            422, "paypal_plan_mismatch", "The PayPal plan pricing could not be verified."
        )
    regular = next(
        (
            cycle
            for cycle in cycles
            if isinstance(cycle, dict)
            and cycle.get("tenure_type") == "REGULAR"
            and cycle.get("sequence") == 1
        ),
        None,
    )
    if not isinstance(regular, dict):
        raise ApiError(
            422, "paypal_plan_mismatch", "The PayPal monthly plan could not be verified."
        )
    frequency_value = regular.get("frequency")
    pricing_scheme = regular.get("pricing_scheme")
    pricing_value = pricing_scheme.get("fixed_price") if isinstance(pricing_scheme, dict) else None
    if not isinstance(frequency_value, dict) or not isinstance(pricing_value, dict):
        raise ApiError(422, "paypal_plan_mismatch", "The PayPal plan pricing is invalid.")
    frequency: JsonDict = frequency_value
    pricing: JsonDict = pricing_value
    try:
        interval_unit = frequency.get("interval_unit")
        interval_count = int(str(frequency.get("interval_count")))
        currency = pricing.get("currency_code")
        amount = Decimal(str(pricing.get("value")))
    except (AttributeError, TypeError, ValueError) as error:
        raise ApiError(
            422, "paypal_plan_mismatch", "The PayPal plan pricing is invalid."
        ) from error
    if (
        interval_unit != expected.interval_unit
        or interval_count != expected.interval_count
        or currency != expected.currency
        or amount != expected.amount
    ):
        raise ApiError(
            422,
            "paypal_plan_mismatch",
            "The PayPal plan, amount, currency or monthly interval does not match this checkout.",
        )

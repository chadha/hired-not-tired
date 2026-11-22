import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing import (
    JsonDict,
    PayPalClient,
    PlanDefinition,
    find_plan,
    plan_definitions,
    verify_remote_plan,
)
from app.billing_schemas import (
    BillingPlan,
    BillingPlansResponse,
    BillingStatus,
    CancellationResponse,
    CancelSubscriptionInput,
    CheckoutIntentInput,
    CheckoutIntentResponse,
    VerifySubscriptionInput,
    VerifySubscriptionResponse,
    WebhookResponse,
)
from app.career_store import run_mutation
from app.config import Settings
from app.database import get_db, utcnow
from app.dependencies import AuthContext, get_current_auth, require_csrf
from app.errors import ApiError
from app.models import (
    AuditEvent,
    BillingCheckoutIntent,
    BillingSubscription,
    PaymentTransaction,
    ProcessedPaypalWebhook,
)

router = APIRouter()
SUBSCRIPTION_EVENTS = {
    "BILLING.SUBSCRIPTION.ACTIVATED",
    "BILLING.SUBSCRIPTION.UPDATED",
    "BILLING.SUBSCRIPTION.CANCELLED",
    "BILLING.SUBSCRIPTION.SUSPENDED",
    "BILLING.SUBSCRIPTION.EXPIRED",
}
PAYMENT_EVENTS = {"PAYMENT.SALE.COMPLETED", "PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"}


def paypal_for(request: Request) -> PayPalClient:
    return request.app.state.paypal  # type: ignore[no-any-return]


def settings_for(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]


def object_field(value: object) -> JsonDict:
    return value if isinstance(value, dict) else {}


def parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def future(value: datetime | None) -> bool:
    if value is None:
        return False
    aware = value if value.tzinfo else value.replace(tzinfo=UTC)
    return aware > utcnow()


def entitled(record: BillingSubscription) -> bool:
    if record.status == "ACTIVE":
        return True
    return record.status == "CANCELLED" and future(record.paid_through)


def status_schema(settings: Settings, record: BillingSubscription | None) -> BillingStatus:
    if record is None:
        return BillingStatus(
            configured=settings.paypal_configured,
            environment=settings.paypal_env,
            detail="No subscription is attached to this account. No paid entitlement is active.",
        )
    active = entitled(record)
    if record.status == "ACTIVE" and record.cancellation_requested_at:
        detail = "Renewal cancellation is recorded; access continues through the confirmed paid-through date."
    elif record.status == "CANCELLED" and active:
        detail = "Cancelled; access continues only through the confirmed paid-through date."
    elif active:
        detail = "PayPal confirms this subscription is ACTIVE."
    else:
        detail = "No paid entitlement is active for the stored PayPal status."
    return BillingStatus(
        configured=settings.paypal_configured,
        environment=settings.paypal_env,
        subscription_id=record.paypal_subscription_id,
        plan_key=record.plan_key,
        status=record.status,
        entitlement_active=active,
        entitlement_plan=record.plan_key if active else None,
        amount=f"{Decimal(str(record.amount)):.2f}",
        currency=record.currency,
        current_period_start=record.current_period_start,
        current_period_end=record.current_period_end,
        paid_through=record.paid_through,
        cancellation_requested_at=record.cancellation_requested_at,
        cancelled_at=record.cancelled_at,
        detail=detail,
    )


async def current_record(db: AsyncSession, auth: AuthContext) -> BillingSubscription | None:
    records = (
        await db.scalars(
            select(BillingSubscription)
            .where(BillingSubscription.user_id == auth.user.id)
            .order_by(BillingSubscription.updated_at.desc())
        )
    ).all()
    return next((record for record in records if entitled(record)), records[0] if records else None)


def apply_remote(
    record: BillingSubscription,
    remote: JsonDict,
    remote_plan: JsonDict,
    expected: PlanDefinition,
) -> None:
    if (
        remote.get("id") != record.paypal_subscription_id
        or remote.get("plan_id") != expected.paypal_plan_id
    ):
        raise ApiError(
            422,
            "paypal_plan_mismatch",
            "The PayPal subscription does not match the pending checkout.",
        )
    verify_remote_plan(remote_plan, expected)
    status = remote.get("status")
    if not isinstance(status, str):
        raise ApiError(
            503, "paypal_invalid_response", "PayPal did not return a subscription status."
        )
    billing_info = object_field(remote.get("billing_info"))
    next_billing = parse_time(billing_info.get("next_billing_time"))
    record.status = status.upper()
    record.current_period_start = parse_time(remote.get("start_time"))
    record.current_period_end = next_billing
    if status.upper() == "ACTIVE":
        record.paid_through = next_billing or record.paid_through
    if status.upper() == "CANCELLED":
        record.cancelled_at = record.cancelled_at or utcnow()
    record.updated_at = utcnow()


@router.get("/billing/plans", response_model=BillingPlansResponse)
async def list_plans(
    request: Request,
    auth: AuthContext = Depends(get_current_auth),
) -> BillingPlansResponse:
    del auth
    settings = settings_for(request)
    return BillingPlansResponse(
        environment=settings.paypal_env,
        plans=[
            BillingPlan(
                key=plan.key,
                name=plan.name,
                amount=f"{plan.amount:.2f}",
                recommended=plan.recommended,
                configured=bool(plan.paypal_plan_id and settings.paypal_client_id),
                paypal_plan_id=plan.paypal_plan_id,
            )
            for plan in plan_definitions(settings)
        ],
    )


@router.get("/billing/subscription", response_model=BillingStatus)
async def get_subscription_status(
    request: Request,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> BillingStatus:
    return status_schema(settings_for(request), await current_record(db, auth))


@router.post("/billing/checkout-intents", response_model=CheckoutIntentResponse)
async def create_checkout_intent(
    payload: CheckoutIntentInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    settings = settings_for(request)

    async def mutate() -> CheckoutIntentResponse:
        plan = find_plan(settings, payload.plan_key)
        if plan is None or not plan.paypal_plan_id or not settings.paypal_configured:
            raise ApiError(503, "paypal_not_configured", "Sandbox checkout not configured yet.")
        intent = BillingCheckoutIntent(
            user_id=auth.user.id,
            plan_key=plan.key,
            paypal_plan_id=plan.paypal_plan_id,
            amount=plan.amount,
            currency=plan.currency,
            expires_at=utcnow() + timedelta(minutes=30),
        )
        db.add(intent)
        await db.flush()
        return CheckoutIntentResponse(
            intent_id=str(intent.id),
            plan_key=plan.key,
            paypal_plan_id=plan.paypal_plan_id,
            amount=f"{plan.amount:.2f}",
            currency=plan.currency,
            environment=settings.paypal_env,
            expires_at=intent.expires_at,
        )

    return await run_mutation(
        db,
        request,
        auth,
        "billing_checkout_created",
        payload.model_dump(mode="json"),
        "billing_checkout",
        payload.plan_key,
        mutate,
    )


@router.post("/billing/verify", response_model=VerifySubscriptionResponse)
async def verify_subscription(
    payload: VerifySubscriptionInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    settings = settings_for(request)

    async def mutate() -> VerifySubscriptionResponse:
        intent = await db.scalar(
            select(BillingCheckoutIntent).where(
                BillingCheckoutIntent.id == payload.intent_id,
                BillingCheckoutIntent.user_id == auth.user.id,
            )
        )
        if intent is None or intent.status not in {"pending", "verification_pending"}:
            raise ApiError(
                404,
                "checkout_intent_not_found",
                "The pending checkout is unavailable in this account.",
            )
        if not future(intent.expires_at):
            raise ApiError(
                409, "checkout_intent_expired", "The pending checkout expired. Start a new one."
            )
        existing = await db.scalar(
            select(BillingSubscription).where(
                BillingSubscription.paypal_subscription_id == payload.subscription_id
            )
        )
        if existing and existing.user_id != auth.user.id:
            raise ApiError(
                409,
                "subscription_claim_conflict",
                "This subscription cannot be attached to your account.",
            )
        remote = await paypal_for(request).get_subscription(payload.subscription_id)
        if remote.get("custom_id") != str(intent.id):
            raise ApiError(
                422,
                "checkout_ownership_mismatch",
                "PayPal did not confirm this checkout belongs to your pending intent.",
            )
        plan = find_plan(settings, intent.plan_key)
        if plan is None:
            raise ApiError(422, "paypal_plan_mismatch", "The stored checkout plan is unavailable.")
        remote_plan = await paypal_for(request).get_plan(intent.paypal_plan_id)
        record = existing or BillingSubscription(
            user_id=auth.user.id,
            paypal_subscription_id=payload.subscription_id,
            plan_key=intent.plan_key,
            paypal_plan_id=intent.paypal_plan_id,
            status="PENDING",
            amount=intent.amount,
            currency=intent.currency,
        )
        apply_remote(record, remote, remote_plan, plan)
        if not existing:
            db.add(record)
        intent.status = "activated" if record.status == "ACTIVE" else "verification_pending"
        intent.updated_at = utcnow()
        await db.flush()
        return VerifySubscriptionResponse(
            verified=record.status == "ACTIVE",
            subscription=status_schema(settings, record),
        )

    return await run_mutation(
        db,
        request,
        auth,
        "billing_subscription_verified",
        payload.model_dump(mode="json"),
        "billing_subscription",
        payload.subscription_id,
        mutate,
    )


@router.post("/billing/cancellation", response_model=CancellationResponse)
async def cancel_subscription(
    payload: CancelSubscriptionInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    settings = settings_for(request)

    async def mutate() -> CancellationResponse:
        record = await db.scalar(
            select(BillingSubscription).where(
                BillingSubscription.paypal_subscription_id == payload.subscription_id,
                BillingSubscription.user_id == auth.user.id,
            )
        )
        if record is None:
            raise ApiError(
                404, "subscription_not_found", "The subscription is unavailable in this account."
            )
        record.cancellation_requested_at = utcnow()
        await paypal_for(request).cancel_subscription(
            payload.subscription_id,
            "Candidate requested cancellation from Hired Not Tired",
        )
        remote = await paypal_for(request).get_subscription(payload.subscription_id)
        plan = find_plan(settings, record.plan_key)
        if plan is None:
            raise ApiError(
                409, "billing_plan_unavailable", "The stored plan mapping is unavailable."
            )
        remote_plan = await paypal_for(request).get_plan(record.paypal_plan_id)
        apply_remote(record, remote, remote_plan, plan)
        record.cancellation_requested_at = record.cancellation_requested_at or utcnow()
        await db.flush()
        return CancellationResponse(subscription=status_schema(settings, record))

    return await run_mutation(
        db,
        request,
        auth,
        "billing_cancellation_requested",
        payload.model_dump(mode="json"),
        "billing_subscription",
        payload.subscription_id,
        mutate,
    )


async def process_subscription_event(
    request: Request,
    db: AsyncSession,
    event_type: str,
    resource: JsonDict,
) -> str:
    subscription_id = resource.get("id")
    if not isinstance(subscription_id, str):
        return "ignored"
    record = await db.scalar(
        select(BillingSubscription).where(
            BillingSubscription.paypal_subscription_id == subscription_id
        )
    )
    if record is None:
        return "ignored"
    remote = await paypal_for(request).get_subscription(subscription_id)
    plan = find_plan(settings_for(request), record.plan_key)
    if plan is None:
        record.status = "REVIEW_REQUIRED"
        return "processed"
    remote_plan = await paypal_for(request).get_plan(record.paypal_plan_id)
    apply_remote(record, remote, remote_plan, plan)
    if event_type == "BILLING.SUBSCRIPTION.CANCELLED":
        record.cancellation_requested_at = record.cancellation_requested_at or utcnow()
    db.add(
        AuditEvent(
            user_id=record.user_id,
            event_type=event_type.lower(),
            resource_type="billing_subscription",
            resource_id=subscription_id,
            request_id=getattr(request.state, "request_id", "unknown"),
            event_data={"status": record.status},
        )
    )
    return "processed"


async def process_payment_event(
    request: Request,
    db: AsyncSession,
    event_type: str,
    resource: JsonDict,
) -> str:
    subscription_id = resource.get("billing_agreement_id")
    transaction_id = resource.get("id")
    if not isinstance(subscription_id, str) or not isinstance(transaction_id, str):
        return "ignored"
    subscription = await db.scalar(
        select(BillingSubscription).where(
            BillingSubscription.paypal_subscription_id == subscription_id
        )
    )
    if subscription is None:
        return "ignored"
    amount_data = object_field(resource.get("amount"))
    try:
        amount = Decimal(str(amount_data.get("total", amount_data.get("value", "0"))))
    except Exception as error:
        raise ApiError(422, "invalid_webhook", "The verified payment amount is invalid.") from error
    currency = amount_data.get("currency") or amount_data.get("currency_code")
    if currency != "EUR" or amount < 0:
        raise ApiError(
            422, "payment_mismatch", "The verified payment currency or amount is invalid."
        )
    expected_amount = Decimal(str(subscription.amount))
    if (event_type == "PAYMENT.SALE.COMPLETED" and amount != expected_amount) or (
        event_type in {"PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"}
        and amount > expected_amount
    ):
        raise ApiError(
            422, "payment_mismatch", "The verified payment amount does not match the stored plan."
        )
    existing = await db.scalar(
        select(PaymentTransaction).where(PaymentTransaction.paypal_transaction_id == transaction_id)
    )
    if existing is None:
        existing = PaymentTransaction(
            user_id=subscription.user_id,
            subscription_id=subscription.id,
            paypal_transaction_id=transaction_id,
            event_type=event_type,
            status=event_type.rsplit(".", 1)[-1],
            amount=amount,
            currency=currency,
            occurred_at=parse_time(resource.get("create_time")) or utcnow(),
        )
        db.add(existing)
    else:
        existing.status = event_type.rsplit(".", 1)[-1]
        existing.updated_at = utcnow()
    sale_id = resource.get("sale_id")
    if event_type in {"PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"} and isinstance(
        sale_id, str
    ):
        original = await db.scalar(
            select(PaymentTransaction).where(
                PaymentTransaction.paypal_transaction_id == sale_id,
                PaymentTransaction.user_id == subscription.user_id,
            )
        )
        if original:
            original.status = event_type.rsplit(".", 1)[-1]
            original.updated_at = utcnow()
    remote = await paypal_for(request).get_subscription(subscription_id)
    plan = find_plan(settings_for(request), subscription.plan_key)
    if plan:
        remote_plan = await paypal_for(request).get_plan(subscription.paypal_plan_id)
        apply_remote(subscription, remote, remote_plan, plan)
    return "processed"


@router.post("/webhooks/paypal", response_model=WebhookResponse)
async def paypal_webhook(request: Request, db: AsyncSession = Depends(get_db)) -> WebhookResponse:
    try:
        event = json.loads(await request.body())
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ApiError(400, "invalid_webhook", "The webhook body is invalid.") from error
    if not isinstance(event, dict):
        raise ApiError(400, "invalid_webhook", "The webhook body is invalid.")
    event_id = event.get("id")
    event_type = event.get("event_type")
    resource = event.get("resource")
    if (
        not isinstance(event_id, str)
        or not isinstance(event_type, str)
        or not isinstance(resource, dict)
    ):
        raise ApiError(400, "invalid_webhook", "Required webhook fields are missing.")
    verified = await paypal_for(request).verify_webhook_signature(
        event=event,
        headers={
            name.lower(): request.headers.get(name)
            for name in (
                "paypal-auth-algo",
                "paypal-cert-url",
                "paypal-transmission-id",
                "paypal-transmission-sig",
                "paypal-transmission-time",
            )
        },
    )
    if not verified:
        raise ApiError(
            400, "invalid_webhook_signature", "PayPal webhook signature verification failed."
        )
    if await db.scalar(
        select(ProcessedPaypalWebhook).where(ProcessedPaypalWebhook.event_id == event_id)
    ):
        return WebhookResponse(status="duplicate")
    outcome = "ignored"
    if event_type in SUBSCRIPTION_EVENTS:
        outcome = await process_subscription_event(request, db, event_type, resource)
    elif event_type in PAYMENT_EVENTS:
        outcome = await process_payment_event(request, db, event_type, resource)
    db.add(ProcessedPaypalWebhook(event_id=event_id, event_type=event_type, processed_at=utcnow()))
    await db.flush()
    return WebhookResponse.model_validate({"status": outcome})
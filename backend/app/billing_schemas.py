from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BillingPlan(BaseModel):
    key: Literal["starter", "pro", "premium"]
    name: str
    amount: str
    currency: Literal["EUR"] = "EUR"
    interval_unit: Literal["MONTH"] = "MONTH"
    interval_count: Literal[1] = 1
    recommended: bool
    configured: bool
    paypal_plan_id: str | None


class BillingPlansResponse(BaseModel):
    environment: Literal["sandbox", "live"]
    plans: list[BillingPlan]


class CheckoutIntentInput(StrictModel):
    plan_key: Literal["starter", "pro", "premium"]


class VerifySubscriptionInput(StrictModel):
    intent_id: UUID
    subscription_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9-]+$")


class CancelSubscriptionInput(StrictModel):
    subscription_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9-]+$")


class CheckoutIntentResponse(BaseModel):
    intent_id: str
    plan_key: str
    paypal_plan_id: str
    amount: str
    currency: str
    environment: Literal["sandbox", "live"]
    expires_at: datetime


class BillingStatus(BaseModel):
    configured: bool
    environment: Literal["sandbox", "live"]
    subscription_id: str | None = None
    plan_key: str | None = None
    status: str | None = None
    entitlement_active: bool = False
    entitlement_plan: str | None = None
    amount: str | None = None
    currency: str | None = None
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    paid_through: datetime | None = None
    cancellation_requested_at: datetime | None = None
    cancelled_at: datetime | None = None
    detail: str


class VerifySubscriptionResponse(BaseModel):
    verified: bool
    subscription: BillingStatus


class CancellationResponse(BaseModel):
    subscription: BillingStatus


class WebhookResponse(BaseModel):
    status: Literal["processed", "ignored", "duplicate"]
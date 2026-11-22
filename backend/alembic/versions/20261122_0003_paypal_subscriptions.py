"""PayPal Sandbox subscriptions, payments and webhook deduplication.

Revision ID: 20261122_0003
Revises: 20261122_0002
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261122_0003"
down_revision: str | None = "20261122_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _id() -> sa.Column:
    return sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True)


def _user_id() -> sa.Column:
    return sa.Column(
        "user_id",
        sa.Uuid(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )


def _timestamps() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def upgrade() -> None:
    op.create_table(
        "billing_checkout_intents",
        _id(),
        _user_id(),
        sa.Column("plan_key", sa.String(32), nullable=False),
        sa.Column("paypal_plan_id", sa.String(128), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("plan_key IN ('starter','pro','premium')", name="ck_checkout_plan"),
        sa.CheckConstraint("currency = 'EUR'", name="ck_checkout_currency"),
    )
    op.create_index("ix_billing_checkout_intents_user_id", "billing_checkout_intents", ["user_id"])
    op.create_index(
        "ix_billing_checkout_intents_expires_at", "billing_checkout_intents", ["expires_at"]
    )

    op.create_table(
        "billing_subscriptions",
        _id(),
        _user_id(),
        sa.Column("paypal_subscription_id", sa.String(128), nullable=False),
        sa.Column("plan_key", sa.String(32), nullable=False),
        sa.Column("paypal_plan_id", sa.String(128), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("current_period_start", sa.DateTime(timezone=True)),
        sa.Column("current_period_end", sa.DateTime(timezone=True)),
        sa.Column("paid_through", sa.DateTime(timezone=True)),
        sa.Column("cancellation_requested_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.CheckConstraint("plan_key IN ('starter','pro','premium')", name="ck_subscription_plan"),
        sa.CheckConstraint("currency = 'EUR'", name="ck_subscription_currency"),
    )
    op.create_index("ix_billing_subscriptions_user_id", "billing_subscriptions", ["user_id"])
    op.create_index("ix_billing_subscriptions_status", "billing_subscriptions", ["status"])
    op.create_index(
        "uq_paypal_subscription_id",
        "billing_subscriptions",
        ["paypal_subscription_id"],
        unique=True,
    )

    op.create_table(
        "payment_transactions",
        _id(),
        _user_id(),
        sa.Column(
            "subscription_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("billing_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("paypal_transaction_id", sa.String(128), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.CheckConstraint("currency = 'EUR'", name="ck_payment_currency"),
    )
    op.create_index("ix_payment_transactions_user_id", "payment_transactions", ["user_id"])
    op.create_index(
        "ix_payment_transactions_subscription_id", "payment_transactions", ["subscription_id"]
    )
    op.create_index(
        "uq_paypal_transaction_id", "payment_transactions", ["paypal_transaction_id"], unique=True
    )

    op.create_table(
        "processed_paypal_webhooks",
        _id(),
        sa.Column("event_id", sa.String(128), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_paypal_webhook_event_id", "processed_paypal_webhooks", ["event_id"], unique=True
    )


def downgrade() -> None:
    op.drop_table("processed_paypal_webhooks")
    op.drop_table("payment_transactions")
    op.drop_table("billing_subscriptions")
    op.drop_table("billing_checkout_intents")

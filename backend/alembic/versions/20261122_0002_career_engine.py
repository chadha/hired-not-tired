"""Candidate-owned jobs, application packages, contacts, outreach and audit.

Revision ID: 20261122_0002
Revises: 20261122_0001
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261122_0002"
down_revision: str | None = "20261122_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _id() -> sa.Column:
    return sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True)


def _user_id(table: str = "users") -> sa.Column:
    return sa.Column(
        "user_id",
        sa.Uuid(as_uuid=True),
        sa.ForeignKey(f"{table}.id", ondelete="CASCADE"),
        nullable=False,
    )


def _created_at() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), nullable=False)


def _updated_at() -> sa.Column:
    return sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False)


def upgrade() -> None:
    op.create_table(
        "profile_revisions",
        _id(),
        sa.Column(
            "profile_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("career_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("candidate_data", sa.JSON(), nullable=False),
        sa.Column("master_profile", sa.JSON(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_profile_revisions_profile_id", "profile_revisions", ["profile_id"])
    op.create_index(
        "uq_profile_revision", "profile_revisions", ["profile_id", "revision"], unique=True
    )

    op.create_table(
        "job_records",
        _id(),
        _user_id(),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("company", sa.String(300), nullable=False),
        sa.Column("location", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("requirements", sa.JSON(), nullable=False),
        sa.Column("salary_min", sa.Integer()),
        sa.Column("salary_max", sa.Integer()),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("remote_type", sa.String(32), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("source_url", sa.String(2048), nullable=False),
        sa.Column("application_method", sa.String(32)),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "application_method IS NULL OR application_method IN ('easy_apply', 'external', 'unknown')",
            name="ck_job_application_method",
        ),
    )
    op.create_index("ix_job_records_user_id", "job_records", ["user_id"])
    op.create_index("uq_job_owner_source", "job_records", ["user_id", "source_url"], unique=True)

    op.create_table(
        "application_packages",
        _id(),
        _user_id(),
        sa.Column(
            "job_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("job_records.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        _created_at(),
        _updated_at(),
    )
    op.create_index("ix_application_packages_user_id", "application_packages", ["user_id"])
    op.create_index("ix_application_packages_job_id", "application_packages", ["job_id"])
    op.create_index(
        "uq_application_package_owner_job",
        "application_packages",
        ["user_id", "job_id"],
        unique=True,
    )

    op.create_table(
        "package_revisions",
        _id(),
        sa.Column(
            "package_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("application_packages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_package_revisions_package_id", "package_revisions", ["package_id"])
    op.create_index(
        "uq_package_revision", "package_revisions", ["package_id", "revision"], unique=True
    )

    op.create_table(
        "hiring_contacts",
        _id(),
        _user_id(),
        sa.Column(
            "job_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("job_records.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("discovery_provider", sa.String(32), nullable=False),
        sa.Column("discovery_query", sa.Text()),
        _created_at(),
        _updated_at(),
    )
    op.create_index("ix_hiring_contacts_user_id", "hiring_contacts", ["user_id"])
    op.create_index("ix_hiring_contacts_job_id", "hiring_contacts", ["job_id"])

    op.create_table(
        "outreach_messages",
        _id(),
        _user_id(),
        sa.Column(
            "job_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("job_records.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "contact_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("hiring_contacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "package_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("application_packages.id", ondelete="CASCADE"),
        ),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("channel IN ('linkedin', 'email')", name="ck_outreach_channel"),
    )
    op.create_index("ix_outreach_messages_user_id", "outreach_messages", ["user_id"])
    op.create_index("ix_outreach_messages_job_id", "outreach_messages", ["job_id"])
    op.create_index("ix_outreach_messages_contact_id", "outreach_messages", ["contact_id"])

    op.create_table(
        "career_interactions",
        _id(),
        _user_id(),
        sa.Column(
            "job_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("job_records.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("data", sa.JSON(), nullable=False),
        _created_at(),
    )
    op.create_index("ix_career_interactions_user_id", "career_interactions", ["user_id"])
    op.create_index("ix_career_interactions_job_id", "career_interactions", ["job_id"])

    op.create_table(
        "audit_events",
        _id(),
        _user_id(),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("resource_type", sa.String(40), nullable=False),
        sa.Column("resource_id", sa.String(64), nullable=False),
        sa.Column("request_id", sa.String(64), nullable=False),
        sa.Column("event_data", sa.JSON(), nullable=False),
        _created_at(),
    )
    op.create_index("ix_audit_events_user_id", "audit_events", ["user_id"])
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])

    op.create_table(
        "idempotency_records",
        _id(),
        _user_id(),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("operation", sa.String(100), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_data", sa.JSON(), nullable=False),
        _created_at(),
    )
    op.create_index("ix_idempotency_records_user_id", "idempotency_records", ["user_id"])
    op.create_index(
        "uq_idempotency_owner_key", "idempotency_records", ["user_id", "key"], unique=True
    )


def downgrade() -> None:
    op.drop_table("idempotency_records")
    op.drop_table("audit_events")
    op.drop_table("career_interactions")
    op.drop_table("outreach_messages")
    op.drop_table("hiring_contacts")
    op.drop_table("package_revisions")
    op.drop_table("application_packages")
    op.drop_table("job_records")
    op.drop_table("profile_revisions")

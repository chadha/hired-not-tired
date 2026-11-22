from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import utcnow
from app.dependencies import AuthContext
from app.models import CareerProfile, ConsentRecord, ExternalIdentity, User
from app.schemas import (
    AccountConsent,
    AuthenticatedWorkspace,
    LinkedInIdentityClaims,
    NoticeType,
)


async def latest_consents(db: AsyncSession, user: User) -> list[AccountConsent]:
    result = await db.execute(
        select(ConsentRecord)
        .where(ConsentRecord.user_id == user.id)
        .order_by(ConsentRecord.recorded_at.desc(), ConsentRecord.id.desc())
    )
    seen: set[str] = set()
    current: list[AccountConsent] = []
    for record in result.scalars():
        if record.notice_type in seen:
            continue
        seen.add(record.notice_type)
        current.append(
            AccountConsent(
                notice_type=record.notice_type,
                notice_version=record.notice_version,
                granted=record.granted,
                recorded_at=record.recorded_at,
            )
        )
    return current


def identity_for(user: User, subject: str) -> LinkedInIdentityClaims:
    return LinkedInIdentityClaims(
        sub=subject,
        name=user.full_name,
        given_name=user.given_name,
        family_name=user.family_name,
        picture=user.picture,
        email=user.email,
        email_verified=user.email_verified,
        locale=user.locale,
    )


async def workspace_for(
    db: AsyncSession,
    auth: AuthContext,
    csrf_token: str,
    settings: Settings,
) -> AuthenticatedWorkspace:
    profile_exists = await db.scalar(
        select(CareerProfile.id).where(CareerProfile.user_id == auth.user.id)
    )
    return AuthenticatedWorkspace(
        candidate_id=auth.user.id,
        identity=identity_for(auth.user, auth.provider_subject),
        first_login=auth.session.first_login,
        career_profile_created=profile_exists is not None,
        consents=await latest_consents(db, auth.user),
        consent_versions={
            cast(NoticeType, notice_type): settings.notice_versions[notice_type]
            for notice_type in (
                "service_terms",
                "privacy",
                "analytics",
                "marketing",
                "research",
            )
        },
        session_expires_at=auth.session.expires_at,
        csrf_token=csrf_token,
    )


def update_claims(user: User, claims: LinkedInIdentityClaims) -> None:
    fields = {
        "full_name": claims.name,
        "given_name": claims.given_name,
        "family_name": claims.family_name,
        "picture": claims.picture,
        "locale": claims.locale,
    }
    for field, value in fields.items():
        if value is not None:
            setattr(user, field, value)
    if claims.email is not None:
        user.email = claims.email
        user.email_verified = claims.email_verified
    user.updated_at = utcnow()


async def provision_user(
    db: AsyncSession,
    claims: LinkedInIdentityClaims,
    settings: Settings,
) -> tuple[User, bool]:
    result = await db.execute(
        select(User)
        .join(ExternalIdentity, ExternalIdentity.user_id == User.id)
        .where(
            ExternalIdentity.provider == "linkedin",
            ExternalIdentity.provider_subject == claims.sub,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        update_claims(existing, claims)
        return existing, False

    user = User(
        full_name=claims.name,
        given_name=claims.given_name,
        family_name=claims.family_name,
        picture=claims.picture,
        email=claims.email,
        email_verified=claims.email_verified if claims.email is not None else False,
        locale=claims.locale,
    )
    db.add(user)
    await db.flush()
    db.add(
        ExternalIdentity(
            user_id=user.id,
            provider="linkedin",
            provider_subject=claims.sub,
        )
    )
    db.add(CareerProfile(user_id=user.id))
    for notice_type, version in (
        ("service_terms", settings.service_terms_version),
        ("privacy", settings.privacy_notice_version),
    ):
        db.add(
            ConsentRecord(
                user_id=user.id,
                notice_type=notice_type,
                notice_version=version,
                granted=True,
            )
        )
    await db.flush()
    return user, True

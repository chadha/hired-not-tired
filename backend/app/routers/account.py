from typing import Any, cast

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db, utcnow
from app.dependencies import AuthContext, require_csrf
from app.errors import ApiError
from app.models import AuthSession, CareerProfile, ConsentRecord, ExternalIdentity, OAuthAttempt
from app.schemas import (
    ConsentsResponse,
    ConsentsUpdate,
    DeleteAccountRequest,
    DeleteAccountResponse,
)
from app.security import clear_auth_cookies
from app.services import latest_consents

router = APIRouter(prefix="/account", tags=["Account"])

RETENTION_NOTICE = (
    "Active profile data is deleted now. Pseudonymized consent audit records may be retained "
    "for up to six years; encrypted backups may retain prior data for up to 30 days. "
    "Legal holds supersede deletion."
)


@router.put("/consents", response_model=ConsentsResponse)
async def update_consents(
    payload: ConsentsUpdate,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> ConsentsResponse:
    settings: Settings = request.app.state.settings
    notice_types = [item.notice_type for item in payload.consents]
    if len(set(notice_types)) != len(notice_types):
        raise ApiError(422, "duplicate_notice_type", "Each notice type may appear only once.")
    for item in payload.consents:
        if settings.notice_versions[item.notice_type] != item.notice_version:
            raise ApiError(
                422,
                "consent_version_invalid",
                f"The current {item.notice_type} notice version must be used.",
            )
        if item.notice_type in {"service_terms", "privacy"} and not item.granted:
            raise ApiError(
                422,
                "essential_consent_required",
                "Essential service terms and privacy acknowledgements cannot be withdrawn here.",
            )
    for item in payload.consents:
        db.add(
            ConsentRecord(
                user_id=auth.user.id,
                notice_type=item.notice_type,
                notice_version=item.notice_version,
                granted=item.granted,
            )
        )
    await db.flush()
    return ConsentsResponse(consents=await latest_consents(db, auth.user))


@router.delete("", response_model=DeleteAccountResponse)
async def delete_account(
    payload: DeleteAccountRequest,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if payload.confirmation != "DELETE":
        raise ApiError(
            422,
            "deletion_confirmation_required",
            "Enter the exact confirmation DELETE to close the account.",
        )
    if auth.user.legal_hold:
        raise ApiError(
            409,
            "account_legal_hold",
            "Account deletion is temporarily restricted by a documented legal hold.",
        )

    sessions = (
        (
            await db.execute(
                select(AuthSession).where(
                    AuthSession.user_id == auth.user.id,
                    AuthSession.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for auth_session in sessions:
        auth_session.revoked_at = utcnow()

    profile_result = cast(
        CursorResult[Any],
        await db.execute(delete(CareerProfile).where(CareerProfile.user_id == auth.user.id)),
    )
    identity_result = cast(
        CursorResult[Any],
        await db.execute(delete(ExternalIdentity).where(ExternalIdentity.user_id == auth.user.id)),
    )
    await db.execute(delete(OAuthAttempt).where(OAuthAttempt.user_id == auth.user.id))

    auth.user.status = "closed"
    auth.user.full_name = None
    auth.user.given_name = None
    auth.user.family_name = None
    auth.user.picture = None
    auth.user.email = None
    auth.user.email_verified = False
    auth.user.locale = None
    auth.user.closed_at = utcnow()
    await db.flush()

    body = DeleteAccountResponse(
        sessions_revoked=len(sessions),
        active_profile_deleted=profile_result.rowcount > 0,
        external_identity_deleted=identity_result.rowcount > 0,
        retention_notice=RETENTION_NOTICE,
    )
    response = Response(
        content=body.model_dump_json(),
        status_code=200,
        media_type="application/json",
    )
    clear_auth_cookies(response, request.app.state.settings)
    return response
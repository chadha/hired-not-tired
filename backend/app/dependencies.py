import hmac
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db, utcnow
from app.errors import ApiError
from app.models import AuthSession, ExternalIdentity, User
from app.security import keyed_hash


@dataclass
class AuthContext:
    user: User
    session: AuthSession
    provider_subject: str


async def get_current_auth(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    settings: Settings = request.app.state.settings
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise ApiError(401, "authentication_required", "Sign in to continue.")
    result = await db.execute(
        select(AuthSession, User, ExternalIdentity.provider_subject)
        .join(User, User.id == AuthSession.user_id)
        .join(
            ExternalIdentity,
            (ExternalIdentity.user_id == User.id) & (ExternalIdentity.provider == "linkedin"),
        )
        .where(
            AuthSession.token_hash == keyed_hash(token, settings),
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > utcnow(),
            User.status == "active",
        )
    )
    row = result.first()
    if row is None:
        raise ApiError(401, "authentication_required", "Sign in to continue.")
    session, user, provider_subject = row
    return AuthContext(user=user, session=session, provider_subject=provider_subject)


async def require_csrf(
    request: Request,
    auth: AuthContext = Depends(get_current_auth),
) -> AuthContext:
    settings: Settings = request.app.state.settings
    origin = request.headers.get("origin")
    if not origin or origin.rstrip("/") not in settings.cors_origin_list:
        raise ApiError(403, "csrf_origin_required", "A trusted request origin is required.")
    token = request.headers.get("x-csrf-token")
    if not token:
        raise ApiError(403, "csrf_token_required", "A CSRF token is required.")
    if not hmac.compare_digest(keyed_hash(token, settings), auth.session.csrf_hash):
        raise ApiError(
            403, "csrf_token_invalid", "The CSRF token is invalid. Bootstrap the session again."
        )
    return auth
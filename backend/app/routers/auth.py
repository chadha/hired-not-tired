import logging
from datetime import timedelta
from typing import cast
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db, utcnow
from app.dependencies import AuthContext, get_current_auth, require_csrf
from app.errors import ApiError
from app.models import AuthSession, CareerProfile, OAuthAttempt
from app.oidc import LinkedInOIDC, OIDCError
from app.schemas import AuthenticatedWorkspace, LinkedInAuthCapability
from app.security import (
    clear_auth_cookies,
    is_expired,
    keyed_hash,
    make_oauth_cookie,
    random_token,
    read_oauth_cookie,
    set_oauth_cookie,
    set_session_cookie,
)
from app.services import provision_user, workspace_for
from app.supabase_auth import SupabaseLinkedInOIDC

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)


def settings_for(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def provider_for(request: Request) -> LinkedInOIDC:
    return cast(LinkedInOIDC, request.app.state.oidc)


def supabase_for(request: Request) -> SupabaseLinkedInOIDC:
    return cast(SupabaseLinkedInOIDC, request.app.state.supabase)


def require_linkedin(settings: Settings) -> None:
    if not settings.oauth_configured:
        raise ApiError(
            503,
            "integration_not_configured",
            "LinkedIn sign-in is not configured. No login was simulated.",
        )


@router.get("/capabilities", response_model=LinkedInAuthCapability)
async def capabilities(request: Request) -> LinkedInAuthCapability:
    settings = settings_for(request)
    configured = settings.oauth_configured
    return LinkedInAuthCapability(
        status="available" if configured else "configuration_required",
        authorization_path="/api/v1/auth/linkedin/authorize" if configured else None,
        scopes=["openid", "profile", "email"],
        missing=[] if configured else settings.missing_oauth_configuration,
        detail=(
            "Supabase LinkedIn OIDC is configured. FastAPI owns the PKCE callback, profile retrieval and secure session."
            if configured and settings.supabase_mode
            else "Backend LinkedIn OIDC is configured. The browser is redirected to the backend-owned authorization route."
            if configured
            else "Supabase or direct LinkedIn OIDC credentials are not configured. Real sign-in is unavailable; no login is simulated."
        ),
    )


@router.get("/linkedin/authorize", status_code=302)
async def authorize(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    settings = settings_for(request)
    require_linkedin(settings)
    state = random_token()
    attempt_secret = random_token()
    attempt = OAuthAttempt(
        state_hash=keyed_hash(state, settings),
        nonce_hash=keyed_hash(attempt_secret, settings),
        redirect_uri=settings.linkedin_redirect_uri,
        expires_at=utcnow() + timedelta(minutes=settings.oauth_attempt_ttl_minutes),
    )
    db.add(attempt)
    await db.flush()
    authorization_url = (
        supabase_for(request).authorization_url(state, attempt_secret)
        if settings.supabase_mode
        else provider_for(request).authorization_url(state)
    )
    response = RedirectResponse(authorization_url, status_code=302)
    set_oauth_cookie(
        response, make_oauth_cookie(attempt.id, attempt_secret, settings), settings
    )
    return response


def callback_failure(code: str, settings: Settings) -> RedirectResponse:
    target = f"{settings.frontend_url}/?{urlencode({'auth_error': code})}"
    response = RedirectResponse(target, status_code=303)
    response.delete_cookie(
        settings.oauth_cookie_name,
        path="/api/v1/auth/linkedin",
        secure=settings.cookie_secure,
    )
    return response


async def valid_attempt(
    request: Request,
    db: AsyncSession,
    state: str | None,
) -> OAuthAttempt | None:
    settings = settings_for(request)
    # Direct LinkedIn returns our state. The signed attempt cookie binds it to this
    # browser; Supabase returns its own flow state and uses the cookie secret as PKCE verifier.
    if not settings.supabase_mode and not state:
        return None
    cookie = read_oauth_cookie(request.cookies.get(settings.oauth_cookie_name), settings)
    if cookie is None:
        return None
    attempt_id, attempt_secret = cookie
    query = select(OAuthAttempt)
    query = (
        query.where(OAuthAttempt.id == attempt_id)
        if settings.supabase_mode
        else query.where(OAuthAttempt.state_hash == keyed_hash(state or "", settings))
    )
    attempt = await db.scalar(query.with_for_update())
    if (
        attempt is None
        or attempt.id != attempt_id
        or attempt.consumed_at is not None
        or attempt.redirect_uri != settings.linkedin_redirect_uri
        or is_expired(attempt.expires_at)
        or keyed_hash(attempt_secret, settings) != attempt.nonce_hash
    ):
        return None
    attempt.consumed_at = utcnow()
    await db.flush()
    return attempt


@router.get("/linkedin/callback", status_code=303)
async def linkedin_callback(
    request: Request,
    code: str | None = Query(default=None, max_length=4096),
    state: str | None = Query(default=None, max_length=4096),
    error: str | None = Query(default=None, max_length=128),
    error_description: str | None = Query(default=None, max_length=2048),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    del error_description  # Deliberately never logged or reflected.
    settings = settings_for(request)
    require_linkedin(settings)
    attempt = await valid_attempt(request, db, state)
    if attempt is None:
        return callback_failure("invalid_state", settings)
    if error:
        return callback_failure(
            "access_denied" if error == "access_denied" else "oauth_failed", settings
        )
    if not code:
        return callback_failure("oauth_failed", settings)

    if settings.supabase_mode:
        cookie = read_oauth_cookie(request.cookies.get(settings.oauth_cookie_name), settings)
        if cookie is None:
            logger.warning("LinkedIn callback rejected request_id=%s stage=oauth_cookie_missing", request.state.request_id)
            return callback_failure("invalid_state", settings)
        _, code_verifier = cookie
        try:
            claims = await supabase_for(request).exchange_code(code, code_verifier)
        except OIDCError:
            logger.warning(
                "LinkedIn callback rejected request_id=%s stage=supabase_code_exchange",
                request.state.request_id,
            )
            return callback_failure("oauth_validation_failed", settings)
    else:
        provider = provider_for(request)
        try:
            id_token = await provider.exchange_code(code)
        except OIDCError:
            logger.warning(
                "LinkedIn callback rejected request_id=%s stage=token_exchange",
                request.state.request_id,
            )
            return callback_failure("oauth_validation_failed", settings)
        try:
            claims = await provider.validate_id_token(id_token)
        except OIDCError:
            logger.warning(
                "LinkedIn callback rejected request_id=%s stage=id_token_validation",
                request.state.request_id,
            )
            return callback_failure("oauth_validation_failed", settings)

    user, first_login = await provision_user(db, claims, settings)
    if user.status != "active":
        return callback_failure("account_closed", settings)
    if await db.scalar(select(CareerProfile.id).where(CareerProfile.user_id == user.id)) is None:
        db.add(CareerProfile(user_id=user.id))
    attempt.user_id = user.id

    token = random_token()
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=keyed_hash(token, settings),
        csrf_hash=keyed_hash(random_token(), settings),
        first_login=first_login,
        expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(auth_session)
    await db.flush()
    logger.info(
        "LinkedIn callback created application session request_id=%s",
        request.state.request_id,
    )
    query = urlencode({"auth": "linkedin", "first_login": "1" if first_login else "0"})
    response = RedirectResponse(f"{settings.frontend_url}/coach?{query}", status_code=303)
    set_session_cookie(response, token, settings)
    response.delete_cookie(
        settings.oauth_cookie_name,
        path="/api/v1/auth/linkedin",
        secure=settings.cookie_secure,
    )
    return response


@router.get("/session", response_model=AuthenticatedWorkspace)
async def session_bootstrap(
    request: Request,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedWorkspace:
    settings = settings_for(request)
    csrf_token = random_token()
    auth.session.csrf_hash = keyed_hash(csrf_token, settings)
    await db.flush()
    return await workspace_for(db, auth, csrf_token, settings)


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    auth: AuthContext = Depends(require_csrf),
) -> Response:
    auth.session.revoked_at = utcnow()
    response = Response(status_code=204)
    clear_auth_cookies(response, settings_for(request))
    return response

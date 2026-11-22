import hashlib
import hmac
import secrets
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Response

from app.config import Settings


def random_token() -> str:
    return secrets.token_urlsafe(32)


def keyed_hash(value: str, settings: Settings) -> str:
    return hmac.new(settings.auth_hash_pepper.encode(), value.encode(), hashlib.sha256).hexdigest()


def _oauth_signature(attempt_id: UUID, attempt_secret: str, settings: Settings) -> str:
    return keyed_hash(f"oauth-cookie:{attempt_id}:{attempt_secret}", settings)


def make_oauth_cookie(attempt_id: UUID, attempt_secret: str, settings: Settings) -> str:
    return (
        f"{attempt_id}.{attempt_secret}."
        f"{_oauth_signature(attempt_id, attempt_secret, settings)}"
    )


def read_oauth_cookie(value: str | None, settings: Settings) -> tuple[UUID, str] | None:
    if not value:
        return None
    parts = value.split(".")
    if len(parts) != 3:
        return None
    raw_id, attempt_secret, signature = parts
    try:
        attempt_id = UUID(raw_id)
    except ValueError:
        return None
    if not attempt_secret or not hmac.compare_digest(
        signature, _oauth_signature(attempt_id, attempt_secret, settings)
    ):
        return None
    return attempt_id, attempt_secret


def is_expired(value: datetime) -> bool:
    normalized = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return normalized <= datetime.now(UTC)


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def set_oauth_cookie(response: Response, value: str, settings: Settings) -> None:
    response.set_cookie(
        settings.oauth_cookie_name,
        value,
        max_age=settings.oauth_attempt_ttl_minutes * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/api/v1/auth/linkedin",
    )


def clear_auth_cookies(response: Response, settings: Settings) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/", secure=settings.cookie_secure)
    response.delete_cookie(
        settings.oauth_cookie_name,
        path="/api/v1/auth/linkedin",
        secure=settings.cookie_secure,
    )

from functools import lru_cache
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_DATABASE = "postgresql+asyncpg://hnt:hnt@localhost:5432/hnt"
LOCAL_PEPPER = "local-only-insecure-hash-pepper-change-me"
TEST_PEPPER = "test-only-insecure-hash-pepper-not-for-production"


def _is_origin(value: str, *, require_https: bool = False) -> bool:
    parsed = urlparse(value)
    schemes = {"https"} if require_https else {"http", "https"}
    return (
        parsed.scheme in schemes
        and bool(parsed.netloc)
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
        and "*" not in value
    )


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["local", "test", "production"] = "local"
    database_url: str = LOCAL_DATABASE
    auth_hash_pepper: str = LOCAL_PEPPER
    frontend_url: str = "http://localhost:8080"
    cors_origins: str = "http://localhost:8080"
    cookie_secure: bool = False
    session_ttl_hours: int = Field(default=168, ge=1, le=720)
    oauth_attempt_ttl_minutes: int = Field(default=10, ge=2, le=30)

    linkedin_client_id: str | None = None
    linkedin_client_secret: str | None = None
    linkedin_redirect_uri: str = "http://localhost:8000/api/v1/auth/linkedin/callback"
    # Existing external Supabase project only. These are read by FastAPI, never VITE_*.
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None

    # Optional compliant public web-search provider. Never used for LinkedIn scraping or messaging.
    search_provider: Literal["brave"] = "brave"
    search_api_key: str | None = None
    needle_api_key: str | None = None
    needle_connected_account_id: str | None = None
    search_api_url: str = "https://api.search.brave.com/res/v1/web/search"
    outbound_timeout_seconds: float = Field(default=10.0, ge=2.0, le=30.0)
    outbound_max_bytes: int = Field(default=1_500_000, ge=10_000, le=5_000_000)

    # PayPal Subscriptions. Sandbox is the only mode enabled by default.
    paypal_env: Literal["sandbox", "live"] = "sandbox"
    paypal_live_enabled: bool = False
    paypal_client_id: str | None = None
    paypal_client_secret: str | None = None
    paypal_webhook_id: str | None = None
    paypal_starter_plan_id: str | None = None
    paypal_pro_plan_id: str | None = None
    paypal_premium_plan_id: str | None = None

    service_terms_version: str = Field(default="2026-11-22", min_length=1, max_length=64)
    privacy_notice_version: str = Field(default="2026-11-22", min_length=1, max_length=64)
    optional_consent_version: str = Field(default="2026-11-22", min_length=1, max_length=64)

    @field_validator(
        "linkedin_client_id",
        "linkedin_client_secret",
        "supabase_url",
        "supabase_publishable_key",
        "search_api_key",
        "needle_api_key",
        "needle_connected_account_id",
        "paypal_client_id",
        "paypal_client_secret",
        "paypal_webhook_id",
        "paypal_starter_plan_id",
        "paypal_pro_plan_id",
        "paypal_premium_plan_id",
        mode="before",
    )
    @classmethod
    def empty_credentials_are_none(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("supabase_url")
    @classmethod
    def normalize_supabase_url(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else value

    @field_validator("frontend_url")
    @classmethod
    def normalize_frontend_url(cls, value: str) -> str:
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_security_configuration(self) -> "Settings":
        if self.paypal_env == "live" and (
            not self.paypal_live_enabled or self.app_env != "production"
        ):
            raise ValueError(
                "PayPal Live requires PAYPAL_LIVE_ENABLED=true in an explicit production environment"
            )
        if self.app_env != "production":
            return self
        errors: list[str] = []
        if not self.database_url or self.database_url == LOCAL_DATABASE:
            errors.append("DATABASE_URL must be explicitly configured")
        if not self.database_url.startswith("postgresql+asyncpg://"):
            errors.append("DATABASE_URL must use postgresql+asyncpg")
        if len(self.auth_hash_pepper) < 32 or self.auth_hash_pepper in {LOCAL_PEPPER, TEST_PEPPER}:
            errors.append("AUTH_HASH_PEPPER must be a unique value of at least 32 characters")
        if not self.cookie_secure:
            errors.append("COOKIE_SECURE must be true")
        if not _is_origin(self.frontend_url, require_https=True):
            errors.append("FRONTEND_URL must be an explicit HTTPS origin")
        if not self.cors_origins or any(
            not _is_origin(origin, require_https=True) for origin in self.cors_origin_list
        ):
            errors.append("CORS_ORIGINS must contain explicit HTTPS origins")
        parsed_redirect = urlparse(self.linkedin_redirect_uri)
        if parsed_redirect.scheme != "https" or not parsed_redirect.netloc:
            errors.append("LINKEDIN_REDIRECT_URI must be HTTPS")
        if (
            parsed_redirect.path != "/api/v1/auth/linkedin/callback"
            or parsed_redirect.query
            or parsed_redirect.fragment
        ):
            errors.append(
                "LINKEDIN_REDIRECT_URI must use the exact callback path without query/fragment"
            )
        if self.frontend_url not in self.cors_origin_list:
            errors.append("CORS_ORIGINS must include FRONTEND_URL")
        if bool(self.linkedin_client_id) != bool(self.linkedin_client_secret):
            errors.append("LinkedIn client ID and secret must be configured together")
        if bool(self.supabase_url) != bool(self.supabase_publishable_key):
            errors.append("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured together")
        if self.supabase_url and not _is_origin(self.supabase_url, require_https=True):
            errors.append("SUPABASE_URL must be an explicit HTTPS origin")
        if self.search_api_key:
            parsed_search = urlparse(self.search_api_url)
            if parsed_search.scheme != "https" or not parsed_search.netloc:
                errors.append("SEARCH_API_URL must use HTTPS when search is configured")
        if errors:
            raise ValueError("Insecure production configuration: " + "; ".join(errors))
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()
        ]

    @property
    def linkedin_configured(self) -> bool:
        return bool(self.linkedin_client_id and self.linkedin_client_secret)

    @property
    def supabase_mode(self) -> bool:
        """An explicitly supplied Supabase setting selects Supabase and fails closed if partial."""
        return bool(self.supabase_url or self.supabase_publishable_key)

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_publishable_key)

    @property
    def oauth_configured(self) -> bool:
        return self.supabase_configured if self.supabase_mode else self.linkedin_configured

    @property
    def search_configured(self) -> bool:
        return bool(self.search_api_key and self.search_api_url)

    @property
    def needle_configured(self) -> bool:
        return bool(self.needle_api_key and self.needle_connected_account_id)

    @property
    def paypal_configured(self) -> bool:
        return bool(
            self.paypal_client_id
            and self.paypal_client_secret
            and self.paypal_starter_plan_id
            and self.paypal_pro_plan_id
            and self.paypal_premium_plan_id
        )

    @property
    def paypal_webhook_configured(self) -> bool:
        return self.paypal_configured and bool(self.paypal_webhook_id)

    @property
    def missing_oauth_configuration(self) -> list[str]:
        if self.supabase_mode:
            return [
                name
                for name, value in (
                    ("SUPABASE_URL", self.supabase_url),
                    ("SUPABASE_PUBLISHABLE_KEY", self.supabase_publishable_key),
                )
                if not value
            ]
        return self.missing_linkedin_configuration

    @property
    def missing_linkedin_configuration(self) -> list[str]:
        return [
            name
            for name, value in (
                ("LINKEDIN_CLIENT_ID", self.linkedin_client_id),
                ("LINKEDIN_CLIENT_SECRET", self.linkedin_client_secret),
            )
            if not value
        ]

    @property
    def session_cookie_name(self) -> str:
        return "__Host-hnt_session" if self.cookie_secure else "hnt_session"

    @property
    def oauth_cookie_name(self) -> str:
        return "__Secure-hnt_oauth" if self.cookie_secure else "hnt_oauth"

    @property
    def notice_versions(self) -> dict[str, str]:
        return {
            "service_terms": self.service_terms_version,
            "privacy": self.privacy_notice_version,
            "analytics": self.optional_consent_version,
            "marketing": self.optional_consent_version,
            "research": self.optional_consent_version,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
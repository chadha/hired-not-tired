import hmac
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from jwt.exceptions import PyJWTError
from pydantic import ValidationError

from app.config import Settings
from app.schemas import LinkedInIdentityClaims
from app.security import keyed_hash

# Keep this identical to issuer in LinkedIn live OIDC discovery metadata.
ISSUER = "https://www.linkedin.com/oauth"
AUTHORIZATION_ENDPOINT = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_ENDPOINT = "https://www.linkedin.com/oauth/v2/accessToken"  # noqa: S105
JWKS_URI = "https://www.linkedin.com/oauth/openid/jwks"


class OIDCError(Exception):
    pass


class LinkedInOIDC:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._jwks: list[dict[str, Any]] = []
        self._jwks_fetched_at = 0.0

    def authorization_url(self, state: str, nonce: str) -> str:
        query = urlencode(
            {
                "response_type": "code",
                "client_id": self.settings.linkedin_client_id,
                "redirect_uri": self.settings.linkedin_redirect_uri,
                "scope": "openid profile email",
                "state": state,
                "nonce": nonce,
            }
        )
        return f"{AUTHORIZATION_ENDPOINT}?{query}"

    async def exchange_code(self, code: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    TOKEN_ENDPOINT,
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "redirect_uri": self.settings.linkedin_redirect_uri,
                        "client_id": self.settings.linkedin_client_id,
                        "client_secret": self.settings.linkedin_client_secret,
                    },
                    headers={"Accept": "application/json"},
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError):
            raise OIDCError("oauth_validation_failed") from None
        id_token = payload.get("id_token") if isinstance(payload, dict) else None
        if not isinstance(id_token, str) or not id_token:
            raise OIDCError("oauth_validation_failed")
        return id_token

    async def _fetch_jwks(self) -> list[dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(JWKS_URI, headers={"Accept": "application/json"})
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError):
            raise OIDCError("oauth_validation_failed") from None
        keys = payload.get("keys") if isinstance(payload, dict) else None
        if not isinstance(keys, list):
            raise OIDCError("oauth_validation_failed")
        self._jwks = [key for key in keys if isinstance(key, dict)]
        self._jwks_fetched_at = time.monotonic()
        return self._jwks

    async def _keys(self, refresh: bool = False) -> list[dict[str, Any]]:
        if refresh or not self._jwks or time.monotonic() - self._jwks_fetched_at > 900:
            return await self._fetch_jwks()
        return self._jwks

    async def validate_id_token(self, id_token: str, expected_nonce: str) -> LinkedInIdentityClaims:
        try:
            header = jwt.get_unverified_header(id_token)
            kid = header.get("kid")
            keys = await self._keys()
            key_data = next((key for key in keys if key.get("kid") == kid), None)
            if key_data is None:
                keys = await self._keys(refresh=True)
                key_data = next((key for key in keys if key.get("kid") == kid), None)
            if key_data is None:
                raise OIDCError("oauth_validation_failed")
            public_key = jwt.PyJWK(key_data).key
            payload = jwt.decode(
                id_token,
                key=public_key,
                algorithms=["RS256"],
                audience=self.settings.linkedin_client_id,
                issuer=ISSUER,
                leeway=60,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
        except OIDCError:
            raise
        except (PyJWTError, ValueError, TypeError):
            raise OIDCError("oauth_validation_failed") from None
        nonce = payload.get("nonce")
        if not isinstance(nonce, str) or not hmac.compare_digest(
            keyed_hash(nonce, self.settings), keyed_hash(expected_nonce, self.settings)
        ):
            raise OIDCError("oauth_validation_failed")
        try:
            return LinkedInIdentityClaims.model_validate(payload)
        except ValidationError:
            raise OIDCError("oauth_validation_failed") from None
import base64
import hashlib
from typing import Any
from urllib.parse import urlencode

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.oidc import OIDCError
from app.schemas import LinkedInIdentityClaims


class SupabaseLinkedInOIDC:
    """Server-side Supabase OAuth adapter; Supabase tokens never reach the browser."""

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.settings = settings
        self.transport = transport

    def authorization_url(self, state: str, nonce: str) -> str:
        # Supabase replaces caller-supplied state with its own flow state. Our signed,
        # single-use attempt cookie correlates the callback; nonce is the PKCE verifier.
        del state
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(nonce.encode()).digest()).rstrip(b"=").decode()
        )
        query = urlencode(
            {
                "provider": "linkedin_oidc",
                "redirect_to": self.settings.linkedin_redirect_uri,
                "scopes": "openid profile email",
                "code_challenge": challenge,
                "code_challenge_method": "s256",
            }
        )
        return f"{self.settings.supabase_url}/auth/v1/authorize?{query}"

    async def exchange_code(self, code: str, code_verifier: str) -> LinkedInIdentityClaims:
        base_url = self.settings.supabase_url
        api_key = self.settings.supabase_publishable_key
        if not base_url or not api_key:
            raise OIDCError("oauth_validation_failed")
        headers = {"apikey": api_key, "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=10.0, transport=self.transport) as client:
                token_response = await client.post(
                    f"{base_url}/auth/v1/token?grant_type=pkce",
                    json={
                        "auth_code": code,
                        "code_verifier": code_verifier,
                        "redirect_to": self.settings.linkedin_redirect_uri,
                    },
                    headers=headers,
                )
                token_response.raise_for_status()
                token_payload = token_response.json()
                access_token = (
                    token_payload.get("access_token") if isinstance(token_payload, dict) else None
                )
                if not isinstance(access_token, str) or not access_token:
                    raise OIDCError("oauth_validation_failed")
                user_response = await client.get(
                    f"{base_url}/auth/v1/user",
                    headers={**headers, "Authorization": f"Bearer {access_token}"},
                )
                user_response.raise_for_status()
                user_payload = user_response.json()
        except OIDCError:
            raise
        except (httpx.HTTPError, ValueError):
            raise OIDCError("oauth_validation_failed") from None
        return self._claims_from_user(user_payload)

    def _claims_from_user(self, payload: object) -> LinkedInIdentityClaims:
        if not isinstance(payload, dict):
            raise OIDCError("oauth_validation_failed")
        user = payload.get("user") if isinstance(payload.get("user"), dict) else payload
        if not isinstance(user, dict):
            raise OIDCError("oauth_validation_failed")
        metadata = user.get("user_metadata")
        metadata = metadata if isinstance(metadata, dict) else {}
        identity_data: dict[str, Any] = {}
        identities = user.get("identities")
        if isinstance(identities, list):
            for identity in identities:
                if not isinstance(identity, dict):
                    continue
                if identity.get("provider") not in {"linkedin_oidc", "linkedin"}:
                    continue
                candidate = identity.get("identity_data")
                if isinstance(candidate, dict):
                    identity_data = candidate
                    break
        combined = {**metadata, **identity_data}
        subject = combined.get("sub") or user.get("id")
        if not isinstance(subject, str) or not subject:
            raise OIDCError("oauth_validation_failed")
        email = user.get("email") or combined.get("email")
        name = combined.get("name") or combined.get("full_name")
        picture = combined.get("picture") or combined.get("avatar_url")
        try:
            return LinkedInIdentityClaims(
                sub=subject,
                name=name if isinstance(name, str) else None,
                given_name=(
                    combined.get("given_name")
                    if isinstance(combined.get("given_name"), str)
                    else None
                ),
                family_name=(
                    combined.get("family_name")
                    if isinstance(combined.get("family_name"), str)
                    else None
                ),
                picture=picture if isinstance(picture, str) else None,
                email=email if isinstance(email, str) else None,
                email_verified=(
                    combined.get("email_verified") is True
                    or isinstance(user.get("email_confirmed_at"), str)
                ),
                locale=(
                    combined.get("locale") if isinstance(combined.get("locale"), str) else None
                ),
            )
        except ValidationError:
            raise OIDCError("oauth_validation_failed") from None
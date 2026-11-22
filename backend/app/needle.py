from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings


class NeedleError(RuntimeError):
    pass


class NeedleClient:
    """Server-side Needle client. Credentials never leave the FastAPI process."""

    base_url = "https://needle.app/api/v1"

    def __init__(self, settings: Settings) -> None:
        self.api_key = settings.needle_api_key
        self.connected_account_id = settings.needle_connected_account_id
        self.timeout = settings.outbound_timeout_seconds

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.connected_account_id)

    def require_configured(self) -> None:
        if not self.configured:
            raise NeedleError("Needle is not configured. Set NEEDLE_API_KEY and NEEDLE_CONNECTED_ACCOUNT_ID on the production backend.")

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        self.require_configured()
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(method, f"{self.base_url}{path}", headers=headers, **kwargs)
            if response.status_code == 429:
                raise NeedleError("Needle usage limit reached. Please try again later.")
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise NeedleError("Needle returned an unexpected response.")
            return payload
        except NeedleError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            raise NeedleError("Needle is temporarily unavailable. No external data was imported.") from exc

    async def get_profile(self, identity: str) -> dict[str, Any]:
        path = f"/linkedin/profiles/{quote(identity, safe='')}?connectedAccountId={quote(self.connected_account_id or '', safe='')}"
        return await self._request("GET", path)

    async def search_jobs(self, *, keywords: str, location: str | None, limit: int) -> dict[str, Any]:
        body: dict[str, Any] = {
            "connectedAccountId": self.connected_account_id,
            "keywords": keywords,
            "limit": min(limit, 50),
            "sortBy": "recent",
        }
        if location:
            body["location"] = location
        return await self._request("POST", "/linkedin/jobs/search", json=body)

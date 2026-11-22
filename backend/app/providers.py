import asyncio
import ipaddress
import json
import re
import socket
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from app.config import Settings


class ProviderError(Exception):
    """Safe provider failure; internal response bodies are never exposed."""


@dataclass(frozen=True)
class ImportedJob:
    title: str
    company: str
    location: str
    description: str
    requirements: list[str]
    application_method: str | None
    source_url: str


@dataclass(frozen=True)
class PublicSearchResult:
    title: str
    url: str
    description: str


def normalize_public_url(value: str) -> str:
    """Validate a public HTTP(S) URL before any outbound request."""
    if len(value) > 2048:
        raise ProviderError("invalid_url")
    try:
        parsed = urlparse(value.strip())
        port = parsed.port
    except ValueError:
        raise ProviderError("invalid_url") from None
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or port is not None
    ):
        raise ProviderError("invalid_url")
    try:
        addresses = [ipaddress.ip_address(parsed.hostname)]
    except ValueError:
        addresses = []
    if any(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
        for address in addresses
    ):
        raise ProviderError("invalid_url")
    if parsed.hostname.lower() in {"localhost", "localhost.localdomain"}:
        raise ProviderError("invalid_url")
    return parsed.geturl()


async def validate_resolved_url(value: str) -> str:
    normalized = normalize_public_url(value)
    hostname = urlparse(normalized).hostname
    if not hostname:
        raise ProviderError("invalid_url")
    try:
        ipaddress.ip_address(hostname)
        return normalized
    except ValueError:
        pass
    try:
        records = await asyncio.to_thread(
            socket.getaddrinfo, hostname, 443, type=socket.SOCK_STREAM
        )
    except socket.gaierror:
        raise ProviderError("destination_unavailable") from None
    for record in records:
        address = ipaddress.ip_address(record[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        ):
            raise ProviderError("invalid_url")
    return normalized


class _DocumentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.json_scripts: list[str] = []
        self.text: list[str] = []
        self.meta: dict[str, str] = {}
        self._json_active = False
        self._json_parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "meta":
            key = attributes.get("property") or attributes.get("name")
            content = attributes.get("content")
            if key and content:
                self.meta[key.lower()] = content.strip()
        if (
            tag == "script"
            and (attributes.get("type") or "").lower().split(";")[0] == "application/ld+json"
        ):
            self._json_active = True
            self._json_parts = []
        if tag in {"script", "style", "noscript", "svg"} and not self._json_active:
            self._ignored_depth += 1
        if tag in {"p", "div", "section", "article", "li", "br", "h1", "h2", "h3", "tr"}:
            self.text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._json_active:
            self._json_active = False
            self.json_scripts.append("".join(self._json_parts))
            return
        if tag in {"script", "style", "noscript", "svg"} and self._ignored_depth:
            self._ignored_depth -= 1
        if tag in {"p", "div", "section", "article", "li", "h1", "h2", "h3", "tr"}:
            self.text.append("\n")

    def handle_data(self, data: str) -> None:
        if self._json_active:
            self._json_parts.append(data)
        elif not self._ignored_depth:
            self.text.append(data)


def _clean_text(value: object, limit: int = 100_000) -> str:
    if not isinstance(value, str):
        return ""
    parser = _DocumentParser()
    try:
        parser.feed(value)
        parser.close()
        raw = " ".join(parser.text) if "<" in value else value
    except Exception:
        raw = value
    lines = [re.sub(r"\s+", " ", line).strip() for line in raw.splitlines()]
    return "\n".join(line for line in lines if line)[:limit].strip()


def _job_nodes(value: object) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [node for item in value for node in _job_nodes(item)]
    if not isinstance(value, dict):
        return []
    node_type = value.get("@type")
    types = node_type if isinstance(node_type, list) else [node_type]
    found = [value] if "JobPosting" in types else []
    graph = value.get("@graph")
    return found + (_job_nodes(graph) if graph is not None else [])


def _nested_name(value: object) -> str:
    if isinstance(value, dict):
        return _clean_text(value.get("name"), 300)
    return _clean_text(value, 300)


def _location(node: dict[str, Any]) -> str:
    if _clean_text(node.get("jobLocationType"), 50).upper() == "TELECOMMUTE":
        return "Remote"
    locations = node.get("jobLocation")
    if isinstance(locations, dict):
        locations = [locations]
    if not isinstance(locations, list):
        return ""
    values: list[str] = []
    for location in locations:
        if not isinstance(location, dict):
            continue
        address = location.get("address")
        if not isinstance(address, dict):
            continue
        parts = [
            _clean_text(address.get(key), 100)
            for key in ("addressLocality", "addressRegion", "addressCountry")
        ]
        joined = ", ".join(part for part in parts if part)
        if joined:
            values.append(joined)
    return " / ".join(values[:2])


def _requirements(node: dict[str, Any], description: str) -> list[str]:
    values: list[str] = []
    for key in ("skills", "qualifications", "experienceRequirements", "responsibilities"):
        raw = _clean_text(node.get(key), 20_000)
        for line in re.split(r"\n+|(?<=[.!?])\s+|\s*[•;]\s*", raw):
            cleaned = line.strip(" -\t")
            if 2 <= len(cleaned) <= 500:
                values.append(cleaned)
    if not values:
        values = [
            line.strip(" -\t") for line in description.splitlines() if 2 <= len(line.strip()) <= 500
        ]
    return list(dict.fromkeys(values))[:30]


def parse_job_page(html: str, source_url: str) -> ImportedJob:
    parser = _DocumentParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        raise ProviderError("job_details_not_found") from None
    nodes = [node for script in parser.json_scripts for node in _job_nodes(_load_json(script))]
    node = nodes[0] if nodes else {}
    title = _clean_text(node.get("title"), 300) or _clean_text(
        parser.meta.get("og:title") or parser.meta.get("twitter:title"), 300
    )
    company = _nested_name(node.get("hiringOrganization"))
    description = _clean_text(node.get("description"), 100_000)
    if not description:
        description = _clean_text(parser.meta.get("description"), 100_000)
    if not title or not company or not description:
        raise ProviderError("job_details_not_found")
    location = _location(node) or _clean_text(parser.meta.get("job:location"), 300)
    easy_apply = (
        "easy apply" in " ".join(parser.text).lower()
        and "linkedin.com" in urlparse(source_url).netloc.lower()
    )
    return ImportedJob(
        title=title,
        company=company,
        location=location,
        description=description,
        requirements=_requirements(node, description),
        application_method="easy_apply" if easy_apply else "external",
        source_url=source_url,
    )


def _load_json(value: str) -> object:
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return {}


class JobPageImporter:
    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.settings = settings
        self.transport = transport

    async def import_url(self, url: str) -> ImportedJob:
        current = await validate_resolved_url(url)
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.outbound_timeout_seconds,
                follow_redirects=False,
                transport=self.transport,
                headers={
                    "Accept": "text/html,application/xhtml+xml",
                    "User-Agent": "HiredNotTired-JobImport/1.0",
                },
            ) as client:
                for _ in range(4):
                    async with client.stream("GET", current) as response:
                        if response.status_code in {301, 302, 303, 307, 308}:
                            location = response.headers.get("location")
                            if not location:
                                raise ProviderError("destination_unavailable")
                            current = await validate_resolved_url(urljoin(current, location))
                            continue
                        if response.status_code != 200:
                            raise ProviderError("destination_unavailable")
                        content_type = response.headers.get("content-type", "").lower()
                        if (
                            "text/html" not in content_type
                            and "application/xhtml+xml" not in content_type
                        ):
                            raise ProviderError("unsupported_content")
                        chunks: list[bytes] = []
                        size = 0
                        async for chunk in response.aiter_bytes():
                            size += len(chunk)
                            if size > self.settings.outbound_max_bytes:
                                raise ProviderError("response_too_large")
                            chunks.append(chunk)
                        html = b"".join(chunks).decode(
                            response.encoding or "utf-8", errors="replace"
                        )
                        return parse_job_page(html, current)
        except ProviderError:
            raise
        except (httpx.HTTPError, UnicodeError):
            raise ProviderError("destination_unavailable") from None
        raise ProviderError("destination_unavailable")


class BraveSearchProvider:
    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.settings = settings
        self.transport = transport

    @property
    def configured(self) -> bool:
        return self.settings.search_configured

    async def search(self, query: str) -> list[PublicSearchResult]:
        if not self.configured:
            raise ProviderError("integration_not_configured")
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.outbound_timeout_seconds, transport=self.transport
            ) as client:
                response = await client.get(
                    self.settings.search_api_url,
                    params={"q": query, "count": 10, "safesearch": "moderate"},
                    headers={
                        "Accept": "application/json",
                        "X-Subscription-Token": self.settings.search_api_key or "",
                    },
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError):
            raise ProviderError("provider_unavailable") from None
        web = payload.get("web") if isinstance(payload, dict) else None
        results = web.get("results") if isinstance(web, dict) else None
        if not isinstance(results, list):
            return []
        output: list[PublicSearchResult] = []
        for result in results[:10]:
            if not isinstance(result, dict):
                continue
            try:
                url = normalize_public_url(str(result.get("url", "")))
            except ProviderError:
                continue
            title = _clean_text(result.get("title"), 500)
            description = _clean_text(result.get("description"), 2000)
            if title:
                output.append(PublicSearchResult(title=title, url=url, description=description))
        return output

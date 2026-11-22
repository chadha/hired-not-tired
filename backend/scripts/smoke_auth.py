#!/usr/bin/env python3
"""Secret-safe HTTP smoke checks. Never follows LinkedIn redirects or prints response bodies."""

import argparse
from urllib.parse import parse_qs, urlsplit

import httpx

AUTHORIZE_PATH = "/api/v1/auth/linkedin/authorize"
CALLBACK_PATH = "/api/v1/auth/linkedin/callback"
CAPABILITIES_PATH = "/api/v1/auth/capabilities"
SESSION_PATH = "/api/v1/auth/session"
LINKEDIN_AUTHORIZATION_ENDPOINT = "https://www.linkedin.com/oauth/v2/authorization"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run_smoke(client: httpx.Client, base_url: str, frontend_origin: str) -> str:
    ready = client.get(f"{base_url}/health/ready")
    require(ready.status_code == 200, f"readiness returned HTTP {ready.status_code}")

    capabilities_response = client.get(f"{base_url}{CAPABILITIES_PATH}")
    require(
        capabilities_response.status_code == 200,
        f"capabilities returned HTTP {capabilities_response.status_code}",
    )
    capability = capabilities_response.json()
    require(capability.get("provider") == "linkedin_oidc", "unexpected capability provider")
    require(
        capability.get("scopes") == ["openid", "profile", "email"],
        "capability scopes differ from openid profile email",
    )
    status = capability.get("status")
    require(
        status in {"available", "configuration_required"},
        "capability is not available or configuration_required",
    )
    if status == "available":
        require(
            capability.get("authorization_path") == AUTHORIZE_PATH,
            "configured capability returned an unexpected authorization path",
        )
    else:
        require(capability.get("authorization_path") is None, "unconfigured path must be null")

    authorize = client.get(f"{base_url}{AUTHORIZE_PATH}")
    if status == "available":
        require(authorize.status_code == 302, f"authorize returned HTTP {authorize.status_code}")
        location = authorize.headers.get("location", "")
        parsed = urlsplit(location)
        expected = urlsplit(LINKEDIN_AUTHORIZATION_ENDPOINT)
        query = parse_qs(parsed.query)
        if parsed.path == "/auth/v1/authorize":
            require(parsed.scheme == "https", "Supabase authorization must use HTTPS")
            require(query.get("provider") == ["linkedin_oidc"], "wrong Supabase provider")
            require(
                query.get("scopes") == ["openid profile email"],
                "Supabase authorize scopes are invalid",
            )
            require(
                query.get("code_challenge_method") == ["s256"],
                "Supabase PKCE method is not S256",
            )
            require(bool(query.get("code_challenge", [""])[0]), "Supabase PKCE is absent")
            require(
                query.get("redirect_to") == [f"{base_url}{CALLBACK_PATH}"],
                "Supabase redirect_to differs from the backend callback",
            )
        else:
            require(
                (parsed.scheme, parsed.netloc, parsed.path)
                == (expected.scheme, expected.netloc, expected.path),
                "authorize did not target LinkedIn's official authorization endpoint",
            )
            require(query.get("response_type") == ["code"], "authorize response_type is not code")
            require(query.get("scope") == ["openid profile email"], "authorize scopes are invalid")
            require(bool(query.get("client_id", [""])[0]), "authorize client_id is absent")
            require(bool(query.get("state", [""])[0]), "authorize state is absent")
            require(bool(query.get("nonce", [""])[0]), "authorize nonce is absent")
        require("client_secret" not in query, "authorize leaked a client secret in its URL")
        callback = client.get(f"{base_url}{CALLBACK_PATH}")
        require(callback.status_code == 303, f"callback returned HTTP {callback.status_code}")
        require(
            urlsplit(callback.headers.get("location", "")).query == "auth_error=invalid_state",
            "callback without state did not fail safely",
        )
    else:
        require(
            authorize.status_code == 503,
            f"unconfigured authorize returned HTTP {authorize.status_code}",
        )
        require("location" not in authorize.headers, "unconfigured authorize returned a redirect")
        callback = client.get(f"{base_url}{CALLBACK_PATH}")
        require(
            callback.status_code == 503,
            f"unconfigured callback returned HTTP {callback.status_code}",
        )

    providers_response = client.get(f"{base_url}/api/v1/providers/capabilities")
    require(providers_response.status_code == 200, "provider capabilities are unavailable")
    providers = providers_response.json()
    require(isinstance(providers.get("contact_discovery"), dict), "contact capability is absent")
    require(
        isinstance(providers["contact_discovery"].get("configured"), bool),
        "contact configuration is not boolean",
    )
    require(isinstance(providers.get("email"), dict), "email capability is absent")
    require(
        isinstance(providers["email"].get("send"), bool), "email send capability is not boolean"
    )

    session = client.get(f"{base_url}{SESSION_PATH}")
    require(session.status_code == 401, f"anonymous session returned HTTP {session.status_code}")

    preflight = client.options(
        f"{base_url}{SESSION_PATH}",
        headers={
            "Origin": frontend_origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type,x-csrf-token",
        },
    )
    require(preflight.status_code == 200, f"CORS preflight returned HTTP {preflight.status_code}")
    require(
        preflight.headers.get("access-control-allow-origin") == frontend_origin,
        "CORS preflight did not allow the exact frontend origin",
    )
    require(
        preflight.headers.get("access-control-allow-credentials") == "true",
        "CORS preflight did not allow credentials",
    )
    return str(status)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--frontend-origin", default="http://localhost:8080")
    parser.add_argument("--require-configured", action="store_true")
    args = parser.parse_args()
    base_url = str(args.base_url).rstrip("/")
    frontend_origin = str(args.frontend_origin).rstrip("/")
    parsed = urlsplit(base_url)
    require(parsed.scheme in {"http", "https"}, "backend URL must use HTTP or HTTPS")
    require(bool(parsed.netloc), "backend URL must include a hostname")
    require(
        not parsed.username and not parsed.password,
        "backend URL must not contain credentials",
    )
    require(
        not parsed.path and not parsed.query and not parsed.fragment,
        "backend URL must be an origin without a path, query or fragment",
    )

    try:
        with httpx.Client(follow_redirects=False, timeout=10.0) as client:
            status = run_smoke(client, base_url, frontend_origin)
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        raise SystemExit(f"SMOKE FAILED: {error}") from None
    if args.require_configured and status != "available":
        raise SystemExit("SMOKE FAILED: LinkedIn is not configured")
    print(
        f"SMOKE PASSED: capabilities={status}; provider/authorize/callback/session/CORS checks passed"
    )


if __name__ == "__main__":
    main()
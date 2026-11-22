import httpx

from app.main import create_app
from tests.conftest import make_test_settings


async def test_unhandled_500_keeps_credentialed_cors_headers() -> None:
    settings = make_test_settings()
    app = create_app(settings)

    @app.post("/api/v1/test-failure")
    async def failure() -> None:
        raise RuntimeError("internal detail must not leak")

    origin = settings.cors_origin_list[0]
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/test-failure", headers={"Origin": origin})

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"
    assert response.headers["x-request-id"]
    body = response.json()
    assert body["error"]["code"] == "internal_error"
    assert body["error"]["request_id"] == response.headers["x-request-id"]
    assert "internal detail" not in response.text


async def test_preflight_allows_every_client_method_and_header() -> None:
    settings = make_test_settings()
    app = create_app(settings)
    origin = settings.cors_origin_list[0]
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        for method in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            response = await client.options(
                "/api/v1/candidates/c/profile",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": method,
                    "Access-Control-Request-Headers": (
                        "content-type,x-csrf-token,idempotency-key,if-match"
                    ),
                },
            )
            assert response.status_code == 200, method
            assert response.headers["access-control-allow-origin"] == origin
            assert response.headers["access-control-allow-credentials"] == "true"

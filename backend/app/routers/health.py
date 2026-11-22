from fastapi import APIRouter, Request
from sqlalchemy import inspect, text

from app.errors import ApiError
from app.schemas import HealthResponse

router = APIRouter(prefix="/health", tags=["System"])


@router.get("/live", response_model=HealthResponse)
async def live() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/ready", response_model=HealthResponse)
async def ready(request: Request) -> HealthResponse:
    try:
        async with request.app.state.session_factory() as session:
            await session.execute(text("SELECT 1"))
        async with request.app.state.engine.connect() as connection:
            required_tables = await connection.run_sync(
                lambda sync: {
                    name
                    for name in (
                        "users",
                        "profile_revisions",
                        "job_records",
                        "application_packages",
                        "billing_checkout_intents",
                        "billing_subscriptions",
                        "payment_transactions",
                        "processed_paypal_webhooks",
                    )
                    if inspect(sync).has_table(name)
                }
            )
        if len(required_tables) != 8:
            raise ApiError(
                503, "schema_not_ready", "Run the database migrations before serving traffic."
            )
    except ApiError:
        raise
    except Exception:
        raise ApiError(503, "database_unavailable", "The database is not ready.") from None
    return HealthResponse(status="ready")
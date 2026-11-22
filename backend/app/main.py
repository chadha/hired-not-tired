import logging
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.billing import PayPalClient
from app.config import Settings
from app.database import make_engine, make_session_factory
from app.errors import error_response, install_exception_handlers
from app.needle import NeedleClient
from app.oidc import LinkedInOIDC
from app.providers import BraveSearchProvider, JobPageImporter
from app.routers import account, auth, billing, career, health
from app.supabase_auth import SupabaseLinkedInOIDC

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    configuration = settings or Settings()
    logging.basicConfig(level=logging.INFO)
    app = FastAPI(
        title="Hired, Not Tired Career Engine API",
        version="0.2.0",
        docs_url=None if configuration.app_env == "production" else "/docs",
        redoc_url=None,
    )
    engine = make_engine(configuration)
    app.state.settings = configuration
    app.state.engine = engine
    app.state.session_factory = make_session_factory(engine)
    app.state.oidc = LinkedInOIDC(configuration)
    app.state.supabase = SupabaseLinkedInOIDC(configuration)
    app.state.search_provider = BraveSearchProvider(configuration)
    app.state.job_importer = JobPageImporter(configuration)
    app.state.needle = NeedleClient(configuration)
    app.state.paypal = PayPalClient(configuration)

    @app.middleware("http")
    async def request_context(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request.state.request_id = uuid.uuid4().hex
        try:
            response = await call_next(request)
        except Exception as exc:
            # Unhandled exceptions otherwise reach Starlette's outermost ServerErrorMiddleware,
            # whose 500 response bypasses CORS; browsers then report an opaque network failure.
            logger.error(
                "Unhandled request failure request_id=%s method=%s path=%s exception_type=%s",
                request.state.request_id,
                request.method,
                request.url.path,
                type(exc).__name__,
            )
            response = error_response(
                request, 500, "internal_error", "An unexpected error occurred."
            )
        response.headers["X-Request-ID"] = request.state.request_id
        if request.url.path.startswith("/api/v1/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    # Registered last so CORS is the outermost application middleware: every response,
    # including request-context 500s, carries credentialed CORS headers for allowed origins.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configuration.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key", "If-Match"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )

    install_exception_handlers(app)
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(account.router, prefix="/api/v1")
    app.include_router(billing.router, prefix="/api/v1")
    app.include_router(career.router, prefix="/api/v1")
    app.include_router(health.router)
    return app


app = create_app()
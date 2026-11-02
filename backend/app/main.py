import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from app.api.auth import router as auth_router
from app.api.generations import router as generation_router
from app.api.library import router as library_router
from app.api.metrics import router as metrics_router
from app.api.routes import router
from app.core.settings import get_settings
from app.db.session import engine
from app.job_recovery import recovery_loop, sweep

settings = get_settings()


@asynccontextmanager
async def lifespan(app):
    await asyncio.to_thread(sweep, engine)
    recovery = asyncio.create_task(recovery_loop(engine))
    try:
        yield
    finally:
        recovery.cancel()
        with suppress(asyncio.CancelledError):
            await recovery


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(auth_router)
app.include_router(library_router)
app.include_router(generation_router)
app.include_router(metrics_router)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    fields = [
        {"field": str(item["loc"][-1]), "message": "입력 형식과 길이를 확인해 주세요."}
        for item in error.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "code": "VALIDATION_ERROR",
                "message": "입력 내용을 확인해 주세요.",
                "fields": fields,
            }
        },
    )

@app.exception_handler(HTTPException)
async def http_error(request: Request, error: HTTPException):
    detail = error.detail
    if not isinstance(detail, dict):
        code = {401: "AUTH_REQUIRED", 404: "NOT_FOUND", 503: "SERVICE_UNAVAILABLE"}.get(
            error.status_code,
            "REQUEST_FAILED",
        )
        detail = {"code": code, "message": str(detail), "fields": []}
    return JSONResponse(
        status_code=error.status_code, content={"detail": detail}, headers=error.headers
    )


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, error: SQLAlchemyError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": {
                "code": "SERVICE_UNAVAILABLE",
                "message": "데이터를 처리하지 못했습니다. 다시 시도해 주세요.",
                "fields": [],
            }
        },
    )

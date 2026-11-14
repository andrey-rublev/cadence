from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api import challenges, collect
from .core.config import settings
from .core.db import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Cadence", lifespan=lifespan)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and int(length) > settings.max_body_bytes:
        return JSONResponse({"detail": "payload_too_large"}, status_code=413)
    return await call_next(request)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


app.include_router(collect.router)
app.include_router(challenges.router)

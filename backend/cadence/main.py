from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import actions, auth, challenges, collect, passive, sites
from .core.config import settings
from .core.db import SessionLocal, init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with SessionLocal() as db:
        sites.register_demo_site(db)
    yield


app = FastAPI(title="Cadence", lifespan=lifespan)

# Partner pages send evidence straight from the browser. Only registered origins, no cookies,
# and only the site-key header: the Cadence site's own routes still need X-Cadence-Client,
# which a cross-origin page cannot send, so this does not open them to other sites.
app.add_middleware(
    CORSMiddleware,
    allow_origins=sites.allowed_origins(),
    allow_methods=["POST"],
    allow_headers=["Content-Type", "X-Cadence-Site"],
    allow_credentials=False,
)


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
app.include_router(auth.router)
app.include_router(actions.router)
app.include_router(passive.router)
app.include_router(sites.partners)
app.include_router(sites.people)

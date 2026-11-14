# Cadence

Behavioural verification as a risk signal for sensitive actions. A hackathon prototype (MadHacks 2026) with measured limitations, not production authentication.

Cadence learns how an enrolled account owner moves and clicks, compares later interactions with that profile, and uses the result to decide when a protected action needs stronger verification.

**Status:** collection mode works end to end. Enrollment, the protected action, the model and the evaluation dashboard are not built yet. [PLAN.md](PLAN.md) has the full plan, the research behind it, and the live status tracker.

## Run it

Needs Python 3.11+ with [`uv`](https://docs.astral.sh/uv/) and Node 20+.

```bash
cd backend && uv sync && cd ..
npm install
```

```bash
cd backend && uv run uvicorn cadence.main:app --port 8000
```

```bash
npm run dev
```

Open http://localhost:5173.

## Check it

```bash
cd backend && uv run pytest
```

```bash
npm run typecheck
```

## Layout

- `backend/` FastAPI, SQLite, challenge generation and server-side replay validation
- `packages/sdk/` browser capture SDK: pointer events only, inside the app, bounded
- `apps/web/` React app (collection mode so far)
- `data/synthetic/` synthetic fixtures only; volunteer and external data are never committed

# Cadence

Behavioural verification as a risk signal for sensitive actions. A hackathon prototype (MadHacks 2026) with measured limitations, not production authentication.

Cadence learns how an enrolled account owner moves and clicks, compares later interactions with that profile, and uses the result to decide when a protected action needs stronger verification.

> **This is the `no-game` branch:** verification from ordinary typing and pointer use, with no challenge to play. See [NO_GAME.md](NO_GAME.md). The challenge version lives on `main`.

**Status (main):** the full loop works: sign-in, trusted enrollment, a movement check on the protected export, and a simulated fallback, all enforced on the server. Volunteer collection is running. **No model trained on real people exists yet**, so on a fresh checkout every check answers "Not enough evidence" until `scripts/train.py` has volunteer data. [PLAN.md](PLAN.md) has the plan, the research behind it, and the live status tracker.

## Run it

Needs Python 3.11+ with [`uv`](https://docs.astral.sh/uv/) and Node 20+. From the repo root:

```bash
npm run setup
```

```bash
npm start
```

That starts the API and the web app together; Ctrl+C stops both. Open http://localhost:5173 for the product, or http://localhost:5173/collect for volunteer data collection. If the ports are busy: `npm start -- --api-port 8002 --web-port 5175`.

| Command | What it does |
|---|---|
| `npm run share` | Snapshot this laptop's recordings into `data/collected/` to commit |
| `npm run typing` | Evaluate the keyboard model on all volunteer typing in `data/collected/` |
| `npm run typing:calibrate` | The same, then re-set the keyboard thresholds on volunteer data |

Train a model from collected data (see PLAN.md for the sandbox option):

```bash
cd backend && uv run python scripts/train.py
```

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
- `apps/web/` React app: the product at `/`, collection mode at `/collect`
- `data/synthetic/` synthetic fixtures only; volunteer and external data are never committed

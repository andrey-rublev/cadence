# Cadence without the game (`no-game` branch)

This branch explores verification with **no challenge to play**. Cadence learns how a person types and moves the pointer while they use the app normally, and decides sensitive actions from recent activity. `main` keeps the challenge-game version; this branch is separate on purpose and is not meant to merge back as-is.

Everything in [PLAN.md](PLAN.md) about honesty still applies: scores are similarities, never probabilities; numbers come from people the model never saw; limitations are shown, not hidden.

## How it works

1. **Consent.** The user agrees to recording of pointer movement and *typing timing* inside the app. The header shows whether capture is on, with a pause button.
2. **Capture (SDK, `packages/sdk/src/passive.ts`).** `startPassive({ root, onWindow })` watches only the app's root element.
   - Pointer: movement and clicks, cut into windows of 12 strokes (a stroke is the movement that ends in a click).
   - Keyboard: key-down and key-up times, cut into windows of 50 presses. Each key is reduced **in the browser** to one of 13 coarse zones (left/right hand × number/top/home/bottom row, plus space, backspace, enter, modifier; `keys.ts`). Characters never leave the page. In password fields, one-time-code fields and anything marked `data-cadence-private`, even the zone is dropped and only timing is sent.
3. **Server (`backend/cadence/api/passive.py`, `passive.py`).** `POST /api/passive` requires sign-in and consent, validates the window (shape, monotonic time, a duration no longer than the server has seen since the previous window, rate limit, no identical resubmission) and stores its features.
   - During a trusted session (within 15 minutes of the demo authenticator) a window builds the **profile**.
   - Otherwise it is **evidence** for the current session, kept for 10 minutes.
4. **Decision (`POST /api/actions/export_customers/authorize`).** Each input with a model and a sufficient profile (6 windows from 2 sign-ins) is scored on its latest 3 evidence windows against its own thresholds. Any input that looks inconsistent holds the export; otherwise a consistent input releases it at once (a single-use, 2-minute grant); otherwise it is uncertain ("keep working, then check again"). No usable evidence is "not enough evidence", never a mismatch. The demo authenticator is always available.
5. **The challenge still exists** behind `?method=challenge`, so the old enforcement tests keep running.

## Models (trained on public data)

| Input | Dataset | Features | Model in use |
|---|---|---|---|
| Typing rhythm | [Aalto 136M Keystrokes](https://userinterfaces.aalto.fi/136Mkeystrokes/) (Dhakal et al., CHI 2018), 1,000 QWERTY desktop/laptop typists | 16 timing features per 50 keys: hold times, gaps between keys, overlap, cross- vs same-hand gaps, rhythm around space, corrections, pauses (`features/keys.py`) | M2 pairwise boosting |
| Pointer movement | [SapiMouse](https://www.ms.sapientia.ro/~manyi/sapimouse/sapimouse.html) (Antal et al. 2021), 120 people | 20 geometry-free stroke features per 12 clicks (`features/strokes.py`) | M2 pairwise boosting |

Both datasets are used for non-commercial research with attribution and are never committed (`data/external/` is gitignored). Download them into `data/external/aalto/Keystrokes.zip` and `data/external/sapimouse/sapimouse.zip`, then:

```bash
cd backend && uv run python scripts/aalto.py --zip ../data/external/aalto/Keystrokes.zip --people 1000
```

```bash
cd backend && uv run python scripts/sapimouse.py --zip ../data/external/sapimouse/sapimouse.zip --model-only
```

Each script picks B0 or M2 by the paired-AUC rule, sets thresholds on held-out people, and activates the model under `artifacts/models/keys/` or `artifacts/models/pointer/`.

## Measured results (people never seen in training, 95% ranges)

**Typing, Aalto, one 50-key sample (about 10–15 s of typing):**

| Training typists | 10 | 50 | 200 | 800 |
|---|---|---|---|---|
| B0 distance | 0.887 | 0.900 | 0.902 | 0.899 |
| M2 pairwise | 0.940 | 0.957 | 0.962 | 0.964 (0.961–0.968), equal error 9.9% |

| Keys per sample | 25 | 50 | 100 |
|---|---|---|---|
| M2 AUC, one sample | 0.938 | 0.964 | 0.980 |
| M2 equal error, one sample | 13.8% | 9.9% | 7.2% |
| M2 equal error, three samples | 10.0% | 7.1% | 5.0% |

With the product's policy (up to three samples, thresholds chosen on held-out typists), the keyboard model let through **5.9% (5.3–6.6%) of impostor checks**, released **88% of owner checks**, and sent 6% of owners to the fallback. The distance baseline only released 66% of owners at the same impostor rate. Keyboard timing is clearly stronger than the mouse per second of activity, and the learned model gains from more training typists up to about 200, then levels off.

**Pointer, SapiMouse, one 12-click sample (about 17 s):** M2 AUC 0.82 (0.80–0.84), equal error 26%; three samples 0.88.

**Caveats that flatter these numbers:**
- Aalto enrollment and probes come from the **same sitting** (first and second half of 15 copied sentences). Our own volunteers showed same-sitting tests overstate accuracy badly (AUC 0.91 vs 0.75 across sessions).
- Aalto is copy-typing of shown sentences, not free writing inside an app.
- In both datasets every person used their own computer, so device differences help.
- Thresholds were set on these datasets and have **not** been calibrated on people using this app. Real impostors on the owner's own laptop will be harder to catch.

## What a user sees

- Header pill: "Learning your rhythm" (trusted session), "Checking quietly", or "Paused", with a pause button.
- Customers page: search and per-customer notes. Notes never leave the page; they exist so normal work produces typing.
- Behaviour profile: progress per input (samples and sign-ins), a typing practice box, live counts towards the next sample, consent and deletion, recent checks, and the model card with held-out comparisons and dataset credits.
- Export: decided instantly. Released, "not sure yet / keep working and check again", "doesn't match, on hold", or "not enough evidence", each with the demo authenticator as the other way through.

## Collecting typing from volunteers

On this branch `/collect` is a typing session, not the game (`collect_mode = "typing"`; `"challenge"` brings the game back). After the usual consent screen, a volunteer answers everyday prompts in their own words for about three minutes. Six 50-key samples complete a session. Only key timing and zones are stored, never the text, under the volunteer's username like the game rounds were.

**The point is a second session on a different day** (the completion screen asks for it), because same-sitting accuracy is what the Aalto numbers overstate. Another laptop or keyboard helps too.

Everything runs from the repo root:

```bash
npm run setup
```

```bash
npm start
```

`npm start` runs the API and the web app together (Ctrl+C stops both); open http://localhost:5173/collect. If those ports are busy: `npm start -- --api-port 8002 --web-port 5175`.

After collecting, snapshot this laptop's recordings (safe while the API runs) and commit the file it names:

```bash
npm run share
```

Then evaluate on every database in `data/collected/`:

```bash
npm run typing
```

and, once at least 5 volunteers have two sessions:

```bash
npm run typing:calibrate
```

`npm run typing` compares the Aalto-trained keyboard model, used as it is, with B0 and M2 trained on the volunteers, all on held-out cross-session scores. `typing:calibrate` keeps the Aalto model but re-chooses its thresholds on the volunteers' cross-session scores and activates that as a new version. It refuses with fewer than 5 volunteers who have two sessions. This is the step that turns "thresholds from a public dataset" into "thresholds measured on our own users".

## Known gaps

- Calibration needs volunteers with typing sessions on two different days; until then the thresholds come from Aalto.
- Passive evidence is produced by the client, so an attacker who controls the browser can script it. It is a risk signal; fallback stays mandatory.
- Phones and tablets: on-screen keyboards hide key positions and touch has no hover path, so passive checks mostly fall back to the authenticator there.
- Users who paste, autofill or never type in the session produce no keyboard evidence.

# Where we are (Sun 15 Nov, 2:30 AM; judging 1 PM)

Quick handoff for the team. Details: [README.md](README.md) (run it, demo steps, results), [PLAN.md](PLAN.md) (research and decision log).

## The product in one paragraph

Cadence is a second factor made from how you type and click, offered as a service other sites plug in. You set it up once on the Cadence site (click test, then typing test). When you protect a site with it, you type that site's own email and password three times so Cadence learns your sign-in there. After that, the site's normal sign-in and sensitive actions (exporting customer records) are checked from the typing and clicking you did anyway. If Cadence isn't sure, it sends you to a verify page with the quick test your own profile is most likely to pass (a typed sentence or 14 circles), or the demo authenticator. Northwind CRM is the fictional company that uses it.

## Branches

| Branch | What it is |
|---|---|
| `main` | The current product (this file). Demo from here. |
| `no-game` | The earlier version: passive checks inside one app, before Cadence became a service for other sites. Left as it was. |
| `main` at `354efa2` | The original challenge game, kept in history only. |

## Run it

From the repo root, after `git pull`:

```bash
npm run setup
```

```bash
npm start
```

| Open | What |
|---|---|
| http://localhost:5173 | Cadence: account, setup, dashboard |
| http://localhost:5180 | Northwind CRM (demo partner) |
| http://localhost:5173/collect | Volunteer typing collection |

Ports busy: `npm start -- --api-port 8002 --web-port 5175 --partner-api-port 8102 --partner-web-port 5182`. The trained models are committed, so no dataset download is needed to run it.

## Demo script (about 4 minutes)

1. Cadence: create an account, agree, click test, typing test. Setup ends there.
2. Northwind: create an account, then Security, Protect with Cadence, approve on Cadence.
3. Back on Northwind: type the Northwind email and password three times when asked.
4. Sign out, sign back in (email, Next, password). Straight in; Northwind shows what Cadence said.
5. A second person signs in with the same password. Held and sent to Cadence's verify page, which recommends a test.
6. Write a customer note, Export customer records: checked the same way.
7. The Cadence dashboard lists every check and whether it was added to the profile.

Tips: type, never autofill, and type the same way in practice and at sign-in. Rehearse with a real second person before judging; we have only tested the impostor with scripted typing.

## Checked tonight

- All 72 backend tests pass; both sites build with no type errors.
- Full flow in a real browser on throwaway databases. Owner sign-in released with no extra step; a very different typing rhythm held; personalised test resolved a held sign-in; export released after typing a note; no console errors; no sideways scrolling at phone width.

## Numbers we can quote (people the models never saw)

| What | Result |
|---|---|
| Sign-in typing, 15 to 45 keys | AUC 0.932, equal error 14.5% (Aalto, 1,000 typists) |
| Typing, 50 keys | AUC 0.964, equal error 9.9% (Aalto) |
| Clicks, 12 per sample | AUC 0.82, equal error 26% (SapiMouse, 120 people) |

Say the caveat with them: Aalto enrollment and test come from the same sitting, and our own volunteers showed that overstates accuracy (0.91 same sitting against 0.75 across sessions). Cadence is a risk signal, not proof of identity; the authenticator in the demo is simulated and labelled so.

## Built but off, and why

- **Comparing a sign-in with your earlier sign-ins on the same site.** Measured on 1,000 Aalto typists, it added only AUC +0.001 to +0.002 over the sign-in model, so no model was saved (`artifacts/reports/aalto-history.json`). Practice sign-ins are still stored and make the profile complete enough for checks. Aalto never repeats text and real sign-ins do, so it may do better on repeated-password data (the CMU keystroke benchmark); measuring that would need the dataset downloaded. Drop a model into `artifacts/models/keys-history/` (train with `backend/scripts/aalto.py --history`) and it switches on by itself.
- **Splitting email and password onto two screens** adds one or two clicks; the click model needs at least 8, so it adds no click evidence. It is there so practice and real sign-ins are typed the same way.

## Known rough edges

- The owner's own sign-in scored 1.72 against a pass mark of 1.59 in testing: real sign-ins will sometimes go to the verify page. That page handles it; present it as the design working, not a failure.
- After a wrong Northwind password, the retry carries only the password's typing, which is often too little; expect the verify page.
- Northwind's "Turn off" only forgets the link on Northwind's side. To redo practice: disconnect Northwind on the Cadence dashboard, then turn Cadence off and on in Northwind.
- Practice is open 30 minutes after connecting, 8 tries.
- `/collect` (volunteer collection) has not been re-checked since the redesign.

## House rules for the repo

- Never commit `data/external/` or `data/volunteer/` (datasets, volunteer exports), or `backend/cadence.db` (each laptop's live database).
- `.claude/launch.json` is a local file; never commit it.
- `npm run share` snapshots your laptop's recordings into `data/collected/` when you want to share them.
- Pull before you start; keep PLAN.md's decision log current.

## Where the code is

| Area | Files |
|---|---|
| Partner API, linking, practice sign-ins, verify | `backend/cadence/api/sites.py` |
| Scoring, sign-in model, test recommendation | `backend/cadence/passive.py` |
| Setup progress | `backend/cadence/setup.py` |
| Northwind's server | `backend/partner_demo/main.py` |
| Browser recording and evidence (SDK) | `packages/sdk/src/activity.ts` |
| Cadence site | `apps/web/src/cadence/` |
| Northwind site | `apps/partner/src/` (sign-in form: `components/SignInFields.tsx`, practice: `components/PracticeSignIns.tsx`) |
| Training | `backend/scripts/aalto.py` (`--login`, `--history`), `backend/scripts/sapimouse.py` |

## Good uses of the time left

1. Rehearse the demo end to end on the judging laptop, with a real second person as the impostor.
2. Check `/collect` still records, if we want more volunteer data.
3. Prepare the pitch around the honest numbers and caveats above.
4. Optional: measure the earlier-sign-ins comparison on repeated-password data (needs a dataset download and a team decision).

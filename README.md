# Cadence

A second factor made from how you type and click. A hackathon prototype (MadHacks 2026) with measured limitations, not production authentication.

Cadence is a service other sites plug in. You set it up once on the Cadence site: a short click test, a typing test with given sentences, and a couple of separate sign-ins. After that, a site that uses Cadence checks the sign-in you were doing anyway. When the typing looks like you, there is no code to fetch. When Cadence is unsure, it picks the quick test **your own profile** is most likely to pass, with an authenticator as the alternative. Every verified sign-in joins your profile, so checks get better informed the more you use it.

## Run it

Needs Python 3.11+ with [`uv`](https://docs.astral.sh/uv/) and Node 20+. From the repo root:

```bash
npm run setup
```

```bash
npm start
```

That starts four services; Ctrl+C stops them all.

| Open | What it is |
|---|---|
| http://localhost:5173 | **Cadence**: create an account, set up (click test, typing test, sign-ins), dashboard |
| http://localhost:5180 | **Northwind CRM**, a fictional company that uses Cadence: sign-in, customers, protected export |
| http://localhost:5173/collect | Volunteer typing collection for evaluation |

If the ports are busy: `npm start -- --api-port 8002 --web-port 5175 --partner-api-port 8102 --partner-web-port 5182`.

### The demo, step by step

1. On **Cadence**, create an account and finish setup. The last step asks you to sign out and back in twice; type your username and password yourself rather than using autofill.
2. On **Northwind**, create an account, open **Security** and choose **Protect with Cadence**. Approve on Cadence.
3. Sign out of Northwind and sign back in. Cadence decides from that sign-in's typing alone; if it looks like you, you are straight in, and Northwind shows what Cadence said.
4. Have someone else sign in with your Northwind password (or type very differently). Cadence sends them to a verify page with a test picked for the account's owner.
5. Write a customer note, then **Export customer records**: the export is checked the same way.
6. The Cadence dashboard lists every check, how it was settled, and whether it was added to your profile.

## How it works

```
Partner page (browser) --typing & clicks--> Cadence /v1/evidence   -> opaque token
Partner server         --token + secret---> Cadence /v1/checks     -> decision for a linked person
  released?            yes: signed in       no: person goes to Cadence /verify/<check>
Cadence /verify        personalised test (typing or clicks) or the demo authenticator
Partner server         ---secret----------> Cadence /v1/checks/<id> -> resolved?
```

- **The partner never sees behaviour data.** The browser sends it to Cadence directly with a public site key; the partner's server only holds an evidence token and asks Cadence for a decision with its secret.
- **Linking is OAuth-style.** The partner sends the person to Cadence `/connect`; they approve while signed in to Cadence; the partner exchanges a one-time code for an opaque subject.
- **No minimum activity.** Whatever was typed or clicked is used. A sign-in (15 to 45 keys, the password part timing only) goes to a model trained for exactly that; longer stretches go to the 50-key model; too little evidence is never a pass, it goes to verification.
- **Personalised step-up.** For each input, Cadence scores every sample in the person's profile against the rest. The input whose own samples sit furthest above the pass mark is the test recommended to them.
- **Learning only from verified checks.** Evidence joins the profile only when the check passed or the person confirmed it. A sign-in that looked like someone else is never learned, even after the person confirms, because one bad sample hurts every later check.
- **Characters never leave the page.** Keys become one of 13 keyboard zones in the browser; password fields send timing only.

Code: `backend/cadence/api/sites.py` (partner API, linking, verification), `backend/cadence/passive.py` (scoring, login model, test recommendation), `backend/cadence/setup.py`, `backend/partner_demo/` (Northwind's server), `packages/sdk/src/activity.ts` (`recordActivity`, `sendEvidence`), `apps/web/src/cadence/` (Cadence site), `apps/partner/` (Northwind's site).

## Measured results (people the models never saw, 95% ranges)

| Model | Data | Result |
|---|---|---|
| Typing at sign-in (15 to 45 keys, last 40% timing only) | Aalto 136M Keystrokes, 1,000 typists | AUC 0.932 (0.927 to 0.937), equal error 14.5%. By length: 15 to 24 keys 0.911, 25 to 34 keys 0.934, 35 to 45 keys 0.950 |
| Typing, 50 keys | Aalto, 1,000 typists | AUC 0.964 (0.961 to 0.968), equal error 9.9% |
| Clicks, 12 per sample | SapiMouse, 120 people | AUC 0.82 (0.80 to 0.84), equal error 26% |

These flatter real use. Aalto enrollment and probes come from the same sitting of copied sentences, and our own volunteers showed same-sitting tests overstate accuracy (AUC 0.91 against 0.75 across sessions). Sign-in probes were cut from sentences, not the same email and password typed each time. Thresholds come from these datasets, not from people using Cadence. Evidence comes from the client, so an attacker controlling the browser can script it: Cadence is a risk signal, and the fallback is always there. The authenticator in this demo is simulated and labelled as such everywhere.

The three models are committed under `artifacts/models/` so a fresh clone works without the datasets. They were trained on research datasets used for non-commercial research with attribution: Dhakal et al., *Observations on Typing from 136 Million Keystrokes* (CHI 2018), and Antal et al., *SapiMouse* (2021). Retrain with `backend/scripts/aalto.py` (add `--login` for the sign-in model) and `backend/scripts/sapimouse.py`. [NO_GAME.md](NO_GAME.md) has the evaluation details; [PLAN.md](PLAN.md) has the research behind the project.

## Other commands

| Command | What it does |
|---|---|
| `npm run share` | Snapshot this laptop's recordings into `data/collected/` to commit |
| `npm run typing` | Evaluate the keyboard model on all volunteer typing in `data/collected/` |
| `npm run typing:calibrate` | The same, then re-set the keyboard thresholds on volunteer data |

## Check it

```bash
cd backend && uv run pytest
```

```bash
npm run typecheck
```

## Layout

- `backend/cadence/` Cadence: FastAPI, SQLite, features, models, partner API
- `backend/partner_demo/` Northwind's own server (fictional partner); its own users and database
- `packages/sdk/` browser SDK: activity recording and evidence for partners, windowed capture, challenge runner
- `apps/web/` the Cadence site, including `/connect`, `/verify/<check>` and `/collect`
- `apps/partner/` Northwind CRM's site
- `data/collected/` volunteer recordings shared between laptops; `data/external/` (datasets) is never committed

Earlier versions are in the history: the challenge game is on `main` up to commit `354efa2`, and the `no-game` branch keeps the in-app passive version from before Cadence became a service for other sites.

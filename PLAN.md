# Cadence — build plan (MadHacks 2026, security track)

> **Teammates: start at [section 12](#12-status-tracker-live)** for what is done, what is next and who owns it. Sections 1–11 are the plan and the reasoning behind it. Update the tracker in the same commit as the work.
>
> Plan approved Sat Nov 14, 2:30 PM CST. Judging is Sun Nov 15, 1:00 PM. Code freeze target: Sun 11:00 AM.
>
> **Since Sun 1 AM, `main` is Cadence as a third-party second factor** (setup on Cadence, partner sites check sign-ins and actions, personalised step-up). The README describes it and how to run the demo; the decision log below records why. The challenge-game plan in sections 3–9 describes the earlier version.

## 1. Context

**What we are building.** Cadence is a web app plus a reusable browser SDK that learns how an enrolled account owner moves and clicks, then compares later interactions with that profile. The result is a *risk signal* that decides whether a sensitive action (Export customer records) needs stronger authentication. It targets stolen credentials, an unlocked laptop, and a session that changed hands. It never replaces normal authentication.

**Where the idea comes from.** A 2026 NTNU master's thesis (Christopher B. Didriksen) built per-player "fingerprints" from Counter-Strike 2 match demos, using repeated mechanics such as flicks, counter-strafes and spray control. Press coverage says the mouse fingerprint picked the right player across 1,000+ players and the keyboard one 98% of the time. That is press reporting only; the thesis itself was not reachable and one outlet quotes the author saying matches were "often only by a fine margin".

**Constraints.**
- MadHacks 2026 is Nov 14–15; judging is 1:00 PM Nov 15. Teams of up to four; we are **two builders**.
- Repo `C:\Users\nikhi\Downloads\GitHub\cadence` is empty (no commits), remote `origin` already set.
- Machine has Python 3.13 + `uv`, Node 24 + `npm` (no pnpm).
- Decisions already made: simulated fallback labelled demo-only (no real passkey); 20+ volunteers; SapiMouse public dataset used and reported separately.

**Success** = a working verification loop, backend enforcement, and an honest evaluation. Not a high accuracy number.

## 2. Research findings that shape the design

### 2.1 Counter-Strike evidence (closest peer-style source)
arXiv 2608.24893, "Account Consistency from Gameplay Traces" (CS2, open-set, test players never seen in training):

| Finding | Number | What we take from it |
|---|---|---|
| One match vs one match | AUC 0.926 (amateur), 0.956 (pro) | Same-person verification on unseen people works |
| 10 history matches aggregated | AUC 0.982 | Aggregate several observations before deciding |
| Aim/crosshair features alone | AUC 0.890 / 0.915 | Identity lives in fine pointing control |
| Adding explicit pair-comparison features | +0.066 to +0.082 AUC, the largest single gain | Use pairwise difference features |
| LightGBM vs MLP | 0.926 vs 0.858 | Small tree model beats a neural net at this scale |
| Same day vs 31–90 days apart | 0.985 vs 0.885 | Same-day hackathon results are optimistic |
| 1 of 5 history samples from another person | 0.975 → 0.963 | Profile contamination hurts; gate profile updates |

Caveat: a match is many minutes of dense, practised aiming on the player's own hardware. A dashboard gives seconds of sparse movement. Expect clearly worse numbers.

### 2.2 Published mouse-dynamics error rates (Khan et al. survey, ACM Computing Surveys 2024)

| Study | Users | Data per decision | Reported error |
|---|---|---|---|
| Shen et al. 2013, fixed task | 37 | 11.8 s | FAR 8.74%, FRR 7.69% |
| Kaixin et al. 2017 | 12 | 30 s | FAR 8.8%, FRR 5.5% |
| Zheng et al. 2011, angle features | 30 | 25 clicks | FAR 2.96%, FRR 0.86% |
| Antal et al. 2021 (SapiMouse, CNN) | 120 | 15 s | AUC 0.94 |
| Antal & Egyed-Zsigmond 2019 (Balabit) | 10 | ~50 actions | EER 18.8%, AUC 0.90 |
| Jorgensen & Yu 2011 (replication of an earlier 0.5% EER claim) | 17 | 325 actions | FAR ~21%, FRR ~21.5% |
| Hinbarji et al. 2015 | 10 | 18.7 min | EER 5.3% |

Takeaways:
- **Realistic target for a ~20 s challenge on unseen users: EER roughly 10–20%.** Single digits would need more interaction or would signal leakage.
- The survey states that common benchmarks do not exist and many studies use ≤10 people. Replications land far above original claims.
- Error rates rise when enrollment and test use different devices (Jorgensen & Yu).
- Nothing short-duration approaches access-control standards (EN 50133-1: FAR < 0.001%, FRR < 1%). This is why Cadence is a risk signal with a fallback.
- Fitts' law and moving targets are rarely used in this literature, so task-geometry normalisation and the tracking task are genuinely less explored.

### 2.3 Attacks
- Tan et al. 2019: an attacker who recorded the victim's movement can generate passing trajectories (imitation attacks). Lopez et al. 2023: replay beats adversarial ML. SapiAgent (2021) generates human-like trajectories.
- Consequence: fresh layouts stop *naive* replay only. We say so in the UI and README.

### 2.4 Statistics we must respect
- Rule of 3: zero errors in N independent trials gives a 95% upper bound of 3/N. Five held-out people with zero false accepts proves almost nothing.
- Rule of 30: a rate needs about 30 observed errors to be stable.
- Attempts from the same person are not independent, so confidence intervals are bootstrapped **by participant** (ISO/IEC 19795-1 Annex B).

### 2.5 Confounds we design against
| Confound | Why it fakes accuracy | Mitigation |
|---|---|---|
| Device identity (DPI, polling rate, pointer acceleration) | In SapiMouse every user has their own device, so a model can learn the device | Resample trajectories to a fixed 60 Hz grid; no raw inter-event timing or step-size features; volunteer data on shared laptops gives same-device impostors |
| Session shortcut | Same-session samples share mood, posture, window size | Positive training pairs are cross-session only; split by whole session first |
| Practice effect | Owner is practised at the challenge, impostor is a novice | Unscored warm-up round before every scored block, for everyone |
| Layout difficulty | Far small targets are slower for everyone | Stratified layouts; Fitts-residual and geometry-normalised features |
| Tiny test sets | Lucky splits | Participant split fixed by hash before any data is seen; counts and CIs always shown |

### 2.6 What differentiates people (feature rationale)
Motor-control traits that are stable within a person and vary between people: speed–accuracy trade-off (personal Fitts slope/intercept), velocity-profile shape (time to peak speed), number and size of corrective submovements, endpoint bias inside the target, direction-dependent speed (wrist vs arm), click hold time, reaction and pre-click dwell, pursuit lag and gain on a moving target, and tremor-band jitter.

## 3. Product scope (tiers with cut lines)

**Tier 1 — must ship (the brief's "one end-to-end path")**
- Mock login, consent screen, enrollment across ≥2 sessions with progress.
- Three challenge tasks in a fixed sequence with fresh layouts: target clicking, drag and drop, moving-target tracking.
- Capture SDK, collection mode for volunteers.
- Feature extraction, distance baseline, protected export enforced on the backend.
- Simulated fallback, labelled demo-only everywhere.

**Tier 2 — should ship**
- Pairwise verifier, SapiMouse pretraining, baseline-vs-model comparison.
- Evaluation dashboard with real metrics, counts, CIs and limitation banners.
- Replay, expiry, cross-session and rate-limit tests.
- Profile deletion, retention setting.

**Tier 3 — extensions, cut in this order if time runs short**
1. Mid-session handoff detection from passive windows (cut first).
2. Adaptive challenge selection.
3. Cross-device genuine test beyond 5 people.

## 4. Architecture

```
cadence/
  PLAN.md  README.md  .gitignore
  apps/web/            Vite + React + TypeScript + Tailwind + shadcn/ui
  packages/sdk/        @cadence/sdk, framework-agnostic TypeScript, zero deps
  backend/
    pyproject.toml     uv project, Python 3.13
    cadence/
      api/             FastAPI routers: auth, consent, challenges, enroll, actions, eval, collect, profile
      core/            config, db (SQLAlchemy + SQLite), security, rate limit
      challenges/      spec v1, layout generator, server-side validation
      features/        resampling, segmentation, kinematic + geometry features, schema
      models/          Verifier interface, baseline, pairwise, artifact loader
      policy.py        decision zones, evidence sufficiency, grants
    scripts/           make_synthetic.py, import_sapimouse.py, export_dataset.py, train.py, evaluate.py
    tests/             pytest: features, validation, replay, policy, split integrity
  data/synthetic/      committed, labelled synthetic fixtures (pipeline tests only)
  data/external/       gitignored, SapiMouse
  data/volunteer/      gitignored, exported volunteer sessions
  artifacts/models/<version>/   model.joblib, feature_schema.json, thresholds.json, eval.json
```

Stack note: the brief dictates React + TypeScript with a FastAPI backend, so the frontend is a Vite SPA rather than the usual Next.js default. Charts use Recharts through shadcn charts.

**One feature codebase.** `backend/cadence/features` is imported by both the API and the training scripts, so online scoring and offline training can never drift apart. Each artifact stores its feature schema; the loader refuses a schema mismatch.

### 4.1 Contracts to freeze in hour 1 (both lanes depend on these)

**Event** (client → server), coordinates in CSS px relative to the challenge area:
`{ t: ms since challenge start (event.timeStamp based), x, y, type: move|down|up, buttons, pointerType }`
Plus per submission: `challenge_id`, `area {w,h,scale}`, `devicePixelRatio`, `declared_device: mouse|trackpad|other`.

**Challenge spec v1** (server-generated from a stored seed, versioned as `task_version`):
- Area: fixed 800×500 CSS px, scaled down only on small viewports (scale recorded).
- Round, about 20 s: 8 target clicks (one per direction octant, 3 distance bins × 2 sizes, stratified), 3 drag-and-drops, one 6 s tracking segment (sum of sinusoids, random phases, fixed frequency content).
- Session block: 1 unscored warm-up round, then 4 rounds (enrollment) or 6 rounds (collection).

**Do not change spec v1 after volunteer collection starts.** Data cannot be re-collected.

**Theme.** The tasks are drawn as a dig-site survey sheet (flat, one accent colour; pen blue always means "act on this"): click targets are marked spots to dig (each leaves a contour-ring depression), the drag is a brass find carried into a tray, and the tracking target is a tunnelling marker that leaves a thin trail. A three-stage progress strip (Dig, Carry, Follow) sits above the sheet. This is artwork only. Positions, sizes, hit areas, timing and the replay rules are untouched, and every piece of art fills exactly its task's hit circle. What people see is still part of the stimulus, so the artwork is frozen together with spec v1 at the pilot.

**Decision** returned by scoring: `CONSISTENT | UNCERTAIN | INCONSISTENT | INSUFFICIENT_EVIDENCE`, with `score`, both thresholds, `evidence {rounds, strokes, seconds}`, `model_version`. Never a probability.

### 4.2 Data model (SQLite)
`accounts`, `sessions` (server-side, HttpOnly SameSite cookie, `trusted_at`), `consents`, `participants` (self-chosen username, split assigned by hash), `challenges` (id, session, purpose, seed, layout, issued/expires/used), `samples` (account or participant, session, task, captured_at, raw events if consented, source = volunteer|synthetic), `features`, `verifications` (score, decision, model version), `action_grants`, `model_registry`.

Identity predictors are never account IDs, device identifiers or filenames. Device fields are metadata for evaluation breakdowns only.

## 5. Capture SDK (`packages/sdk`)
- API: `createCadence({ endpoint, root })`, `start()`, `stop()`, `captureChallenge(element, challenge)`, `status`.
- Listens only inside `root`. Pointer events only; no keyboard, no typed content, nothing outside the app.
- Uses `pointerrawupdate` where available (Chromium, secure context; localhost qualifies), otherwise `pointermove` with `getCoalescedEvents()`, de-duplicating the parent event. Without this, browsers deliver about one move per frame.
- Timestamps from `event.timeStamp`. Browsers coarsen timer precision, which is another reason features use a 60 Hz resampled grid.
- Refuses to start without recorded consent. Bounded windows (max events and max seconds), ring buffer, batched upload.
- Visible start/stop control and a capture indicator in the app.

## 6. Backend behaviour

**Auth and trust.** Seeded demo accounts with hashed passwords. "Trusted verification" is the simulated fallback: a one-time code shown in a panel titled "Demo authenticator — simulated, not production authentication". It sits behind a `TrustedVerifier` interface so a passkey can replace it later.

**Enrollment.** Allowed only when the session has a recent `trusted_at`. Profile status stays `insufficient` until ≥2 separate sessions and ≥6 scored rounds. Profile updates always require trusted verification, so unverified activity cannot drift the baseline.

**Challenges.** Server issues a random ID bound to the session and purpose, with a 90 s expiry, single use (atomic mark-used). Submission validation: ownership, expiry, unused, schema, payload size, monotonic timestamps, event-count and duration bounds, client duration ≤ server elapsed time, required targets hit in order (server-side hit test against the stored layout), drag ends in the drop zone, tracking coverage. Rate limit: 5 challenge submissions per 10 minutes per session, then fallback only.

**Protected action.**
1. `POST /api/actions/export/authorize` runs policy and, if allowed, creates an `action_grant` row bound to session + action, 120 s expiry, single use.
2. `POST /api/export` succeeds only with a valid unused grant. Frontend state cannot bypass it.

**Policy.**
| Decision | Result |
|---|---|
| CONSISTENT | Grant under existing authentication |
| UNCERTAIN | One more round (max 2 extra, scores aggregated), or offer fallback |
| INCONSISTENT | Hold the action, require fallback |
| INSUFFICIENT_EVIDENCE (no profile, no model, too little data, incomplete challenge) | Challenge or fallback, never approve |

A failed check blocks only that action attempt. The fallback is always available and no lockout is permanent.

## 7. Behavioural model

**Preprocessing.** Resample to 60 Hz, light smoothing for derivatives, segment into strokes (movement onset → click/drop) and the tracking segment.

**Features** (per stroke, then median and IQR per task type per round):
- *Kinematic block K* (no target knowledge, works on SapiMouse too): peak and mean speed, time-to-peak fraction, peak acceleration and deceleration, jerk-based smoothness, submovement count, path efficiency, max and signed deviation from the straight line, direction changes, click hold time, pre-click dwell, speed by direction octant.
- *Geometry block G* (Cadence challenges only): Fitts index of difficulty `log2(D/W + 1)`, residual from a training-population Fitts fit, throughput, reaction time, overshoot / target width, endpoint offset / target radius, corrections after first target entry, drag pickup delay and drop precision, tracking RMS error / target size, pursuit lag, gain, time-on-target, 4–12 Hz jitter power.

**Models** (all behind one `Verifier` interface: `fit`, `score(enrollment, probe)`):
- **B0 baseline:** scaled Manhattan distance from the probe to the account's enrollment template; scaling fitted on training data only.
- **M1 pairwise verifier:** inputs are absolute and relative differences between an enrollment round and a probe round; scikit-learn `HistGradientBoostingClassifier`, with logistic regression as a check. Probe score is the mean over all enrollment rounds. Trained only on training participants, with cross-session positives and same-device negatives preferred.
- Variants reported side by side: B0-K, M1-K trained on SapiMouse (zero-shot on volunteers), M1-K+G trained on volunteers.
- No neural sequence model unless M1 clearly underfits. Not planned.

**Thresholds.** Two thresholds chosen on validation participants only: accept at validation FAR ≤ 5%, reject at validation FRR ≤ 5%; between them is UNCERTAIN. Evidence sufficiency (minimum rounds, strokes, seconds) is checked separately, so "too little data" is never shown as a mismatch.

**Adaptive extension (Tier 3).** Next task type chosen by its measured validation discriminability and the current score's distance from the thresholds. Kept separate from the layout random generator.

## 8. Data collection and evaluation

**Volunteer protocol (collection mode, 20+ people).**
- Consent screen, then a username the volunteer chooses (asked not to be their real name). It is their only identifier; no names or contact details are stored.
- Session A (about 3 min), then Session B (about 3 min). Separate session IDs. No minimum break is enforced (decided Sat evening so more volunteers finish two sessions); a break is encouraged on screen. Start and end times are stored, so the evaluation reports the actual gap between sessions and treats back-to-back pairs as a best case.
- Shared collection laptops give *different people on the same device*.
- At least 5 volunteers add a Session C on a second device (mouse vs trackpad) for *same person across devices*.
- The two builders pilot first to catch capture bugs, and their data is excluded from evaluation.

**Split discipline.**
- Participants are assigned to train / validation / test (about 60 / 20 / 20) by a salted hash of the username, fixed before any data is viewed. With about 20 people the counts can come out lopsided; the export script may rebalance over the merged set by hash order (blocks of 3/1/1), which stays blind to the data.
- Usernames are typed by hand, so the export script must report near-duplicate usernames (for example `molefan` and `molfan`) for a manual check before training. A typo that splits one person in two would count them as their own impostor.
- Split by whole session before feature building or pair construction. Preprocessing fitted on train only. No overlapping windows across splits.
- Test participants are never in verifier training: Session A enrolls, Session B is the genuine probe, other test participants are unfamiliar impostors.
- Tighter estimate if time allows: participant-grouped cross-validation with thresholds chosen in an inner fold.

**SapiMouse (120 people, a 3-minute and a 1-minute session each).**
- Subject-disjoint 72 / 24 / 24 split. Enroll on the 3-minute session, probe with chunks of the 1-minute session.
- Gives the K-block model its training data and a larger unseen-user estimate.
- Limits stated on the dashboard: free-form task with no target geometry, both sessions same day, and every user on their own device (so device and person are confounded). Data licence is unstated; cited as research use and never committed to the repo.
- Download is a single zip from the Sapientia University page, fetched by `import_sapimouse.py` and parsed as CSV only.

**Reported, on untouched test sessions only.** FAR and FRR at the chosen thresholds, EER, AUC, share of attempts landing in UNCERTAIN, attempt and participant counts, participant-bootstrap 95% intervals, interaction seconds per decision, and error vs number of rounds. Breakdowns: same-device impostors, cross-device genuine. Every model beside B0.

**Honesty rules in code.** `evaluate.py` writes `eval.json` with counts. Below minimum counts (for example fewer than 5 test participants or 30 impostor attempts) the dashboard shows "not enough data for a reliable estimate" in place of a headline number. Synthetic fixtures are tagged `source = synthetic`, used only for pipeline tests, and can never enter `eval.json`.

## 9. Frontend (`apps/web`)
Screens: sign in, consent, enrollment with progress, challenge, mock dashboard (fictional customers, account area, Export customer records), fallback panel, evaluation view, collection mode.

- Plain-language explanation before each challenge.
- "Not enough evidence" and "Doesn't match" are visually and verbally distinct states.
- Scores are shown against thresholds as a similarity, never as a probability of identity.
- Evaluation view: score, thresholds, evidence sufficiency, challenge history, model version, real metrics from `eval.json`. No fabricated events.
- Accessibility: every control keyboard reachable with visible focus; a "I can't complete this" button on every challenge leads to the non-behavioural path; reduced-motion respected; recovery explained for device changes, injuries and assistive technology.
- Privacy: consent before capture, what is collected in plain words, retention setting, delete-my-profile (removes profile, samples and features).

## 10. Two-person schedule

Hours are relative to start; code freeze is 2 hours before judging.

| Phase | Lane A — app (frontend, SDK, backend) | Lane B — model and data |
|---|---|---|
| 0–1 h | Freeze section 4.1 contracts together; scaffold repo, `PLAN.md`, `.gitignore` | same |
| 1–4 h | SDK capture, three challenge components, challenge issue/submit/store, collection mode | Synthetic fixtures, resampling + K features, B0, eval harness, SapiMouse import |
| 4 h | **Gate: pilot collection with both builders, then freeze spec v1** | |
| 4–10 h | Auth, consent, enrollment, grants, policy, fallback, validation, rate limits | Recruit and run volunteers; G features; M1 on SapiMouse |
| 10–14 h | Wire artifact loading and scoring; **Tier 1 end-to-end works** | Export volunteer data; train and evaluate; thresholds from validation |
| 14–18 h | Evaluation dashboard, deletion, replay and session tests | Model comparison, breakdowns, `eval.json`, limitation text |
| 18 h–freeze | Accessibility pass, browser review, README, demo rehearsal with a real second person | Tier 3 only if everything above is done |

Volunteer collection is the bottleneck, so collection mode ships before anything else in the app.

## 11. Verification

- `uv run pytest` in `backend/`: feature determinism, split integrity (no participant or session crosses splits), challenge validation, policy table, replay (reused ID rejected, old trajectory on a new layout rejected, cross-session ID rejected, expired ID rejected), export without a grant rejected, grant reuse rejected, missing model and insufficient enrollment never approve.
- `uv run python scripts/train.py` then `evaluate.py` run end to end on synthetic fixtures (pipeline check only) and on real data.
- Frontend: `npm run build` and type-check clean; Playwright pass over sign-in → consent → enrollment → export → challenge → fallback at mobile, tablet and desktop widths, with console checked. Library APIs (Vite, React, Tailwind, shadcn/ui, FastAPI, scikit-learn) are checked against current docs via Context7 before use.
- Manual demo run: volunteer enrolls, returns in a new session and exports; a second person tries the same account on the same laptop; actual decisions shown whatever they are.

## 12. Status tracker (live)

### Product usability

- [x] Preserve browser-filled credentials, keep the login screen still until the user chooses a field, and focus the password after a rejected sign-in.
- [x] Keep account controls usable with long email addresses at phone and tablet widths.
- [x] Offer the remaining quick test after a miss, let users recover a lost test response by checking its status, and return immediately after confirmation.
- [x] Keep an existing Northwind session recoverable when a session check or sign-out request fails.
- [x] Keep the partner’s return URL available for a retry when the network drops while finishing a Cadence connection, sign-in, export, or account deletion. Finish still requires the server’s existing checks.
- [x] Let setup continue from saved progress after an interrupted upload. Show the remaining work after a rejected sample and explain the mouse or trackpad requirement on touchscreen-only devices.

Owner: **A** = app lane (frontend, SDK, backend API), **B** = model and data lane. State: `[ ]` todo, `[~]` in progress, `[x]` done, `[-]` cut.

### Working agreement: commit and push automatically
This applies to both builders and to any AI assistant working in the repo. Do it without being asked.

- **Commit and push to `origin/main` after every completed tracker item or working change.** Small commits; the message says what changed.
- Tick the tracker item in the same commit as the work.
- Before pushing: `git pull --rebase origin main`, then run the checks for what you touched (`cd backend && uv run pytest`, `npm run typecheck`). Never push a broken build; if a check fails, fix it first.
- No AI attribution lines in commit messages or pull requests. Commits are authored by the team.
- Never committed (already in `.gitignore`): the live database `backend/cadence.db`, `data/volunteer/`, `data/external/`, `.env`. If the live database is tracked, every `git pull` on a collection laptop overwrites that laptop's recordings with someone else's.
- **Sharing collected data:** stop the API, then copy the live database to `data/collected/<station>.db` (for example `cp backend/cadence.db data/collected/nathaniels-laptop.db`; stopping the API first folds the WAL into the file) and commit that copy. Snapshots are tracked on purpose; the repo is private. A newer snapshot of the same laptop replaces the older file. Rounds deleted on request disappear from the snapshot but stay in git history, so say so if a deletion must also be purged from history.

### Done so far
- [x] Research: Counter-Strike source, published error rates, attacks, statistics, confounds (section 2)
- [x] Decisions: simulated fallback, SapiMouse, 20+ volunteers, two lanes (section 1)
- [x] Plan and this document

### Gate 1 — collection mode live (target: Sat 6:30 PM)
- [x] A — Repo scaffold: `backend/` (uv), `apps/web/` (Vite), `packages/sdk/`, `.gitignore`
- [x] A — Contracts in code: event format, challenge spec v1, replay rules (`backend/cadence/challenges/`, mirrored in `packages/sdk/src/`)
- [x] A — Backend: challenge issue, submit, server-side replay validation, raw sample storage (22 tests pass)
- [x] A — Capture SDK: pointer recorder and challenge runner (`recorder.ts`, `challenge.ts`, `client.ts`)
- [ ] A — Capture SDK: passive in-app windows with start/stop control and consent gate (`createCadence`); needs the Gate 2 endpoint
- [x] A — Three challenge tasks in one sheet: target click, drag and drop, tracking
- [x] A — Dig-site survey-sheet theme for the tasks (dig spots, find into tray, follow the marker) and round progress strip; cosmetic only, in `apps/web/src/challenge/DigArt.tsx`
- [x] A+B — Pilot run on a real mouse (18 rounds, ~190 samples/s, rounds of 13–18 s). **Spec v1 and its artwork are frozen from the commit that adds this line. Collect only on that commit or later, and do not change `spec.py`, `replay.py`, `DigArt.tsx` or `ChallengeSheet.tsx` visuals afterwards.** Collection URL: `http://localhost:5173/collect`
- [x] A — Collection mode: consent, self-chosen username, sessions A/B/C, practice round + 6 rounds, no enforced break
- [x] A — Browser check with real pointer events: a full session accepted by the server; desktop, tablet and mobile layouts reviewed
- [x] B — Synthetic player (`backend/cadence/synthetic.py`), used by tests; labelled synthetic
- [ ] B — Synthetic fixture files for the training pipeline (`scripts/make_synthetic.py`)
- [ ] B — Resampling, stroke segmentation, kinematic features (block K) in `backend/cadence/features/`
- [x] B — Baseline B0 and evaluation harness (`verifier/evaluation.py`): participant-held-out scores (leave-pair-out up to 16 people, 5 grouped folds above), nested thresholds, the product policy replayed on held-out attempts, 95% participant-bootstrap intervals, same-station vs other-station breakdown
- [x] B — SapiMouse import and experiments (`scripts/sapimouse.py`, reads the zip in `data/external/sapimouse/` directly; download it from the dataset page)
- [x] B — Geometry-free stroke features, block K (`features/strokes.py`), shared by SapiMouse, volunteers and future passive capture
- [ ] A+B — **Pilot: both builders run one collection session on each laptop with a real mouse and a trackpad; fix anything odd; then freeze spec v1**
- [ ] A+B — Delete-by-username script for volunteer recordings (promised on the consent screen)
- [ ] B — Export script: merge laptops by username, flag near-duplicate usernames, report the gap between each person's sessions

### Gate 2 — Tier 1 end to end (target: Sun 4:30 AM)
- [x] A — **Backend for the whole Gate 2 loop** (36 tests): accounts and sign-in (`api/auth.py`), consent and profile deletion, simulated fallback, enrollment gated on consent + trusted verification, feature extraction (`features/extract.py`, 42 features), baseline verifier B0 and thresholds (`verifier/`), policy (`policy.py`), action grants and the protected export (`api/actions.py`), rate limits, and `scripts/train.py`. Web screens for these are next
- [x] A — Web: sign-in and account creation (`apps/web/src/product/SignIn.tsx`)
- [x] A — Web: consent, optional raw-path retention, delete-my-profile behind trusted verification (`ProfileView.tsx`)
- [x] A — Web: enrollment with progress, a practice round, and rounds from two separate sign-ins
- [x] A — Simulated fallback, labelled demo-only on every surface (`FallbackPanel.tsx`)
- [x] A — Protected export flow with four visibly different outcomes and a similarity meter (`ExportFlow.tsx`, `DecisionMeter.tsx`)
- [x] A — Mock dashboard with fictional customers (`CustomersView.tsx`, `backend/cadence/demo_data.py`)
- [x] A — Geometry features (block G) are part of the 42 features in `features/extract.py`
- [x] A+B — Model artifact loaded by the backend; scoring wired into policy
- [x] A — End-to-end browser run in a sandbox: an owner enrolled over two sign-ins was accepted and exported; a different movement style was held; a direct API export without a grant returned 403; the fallback released it
- [ ] B — Recruit and run 20+ volunteers (sessions A and B; ≥5 with session C on a second device). **In progress**
- [x] B — **Real model trained** on both laptops (Sat 6:20 PM, 10 volunteers, 8 with a session on each laptop, 107 rounds). Retrain whenever new snapshots land in `data/collected/`; the numbers below change with every person added. Until a model is activated on a machine, every check there answers "Not enough evidence"
- [x] B — Pairwise verifiers on volunteers, compared against B0 (`verifier/pairwise.py`): M1 logistic regression and M2 gradient boosting on per-feature gaps, cross-session positives only. SapiMouse-pretrained block-K variants were tested too and do not transfer (see results below)
- [x] A — Retention purge (`retention.py`, on API start-up and hourly): the profile (`enroll`, `login`, `signin` windows and enrollment rounds) stays until deleted; evidence windows, raw recordings, verifications, site checks and expired codes, tokens, grants and challenges go after 30 days. Volunteer recordings are not touched
- [ ] A — Capture SDK passive in-app windows with a start/stop control (`createCadence`)

### Gate 3 — evaluation and hardening (target: Sun 8:30 AM)
- [x] B — `eval.json`: baseline vs models, counts, CIs, same-station and cross-laptop breakdowns
- [x] A — Evaluation view: the Movement profile page shows what checks decided for unseen people (with ranges), B0 vs M1 vs M2, the station breakdown, limitations and the protocol, all read from `eval.json`; reviewed at desktop and 390 px

#### Latest held-out results (Sat 6:20 PM, 10 people, 8 with two sessions)
| Model | AUC, 1 round | AUC, 3 rounds | Equal error, 1 round |
|---|---|---|---|
| B0 distance (in use) | 0.80 (0.66–0.92) | 0.82 (0.64–0.95) | 26% (13–37%) |
| M1 pairwise logistic | 0.77 (0.57–0.90) | 0.81 (0.57–0.95) | 32% (17–46%) |
| M2 pairwise boosting | 0.85 (0.72–0.94) | 0.93 (0.81–0.99) | 25% (14–36%) |

With B0 and the product policy (up to three rounds), 6% (1–17%) of impostor checks were let through, 44% (19–71%) of owner checks were let through, and 50% (25–75%) of owners ended at the fallback. M2's AUC gain over B0 is +0.05 (−0.02 to +0.14), not enough to replace the baseline yet. Every owner attempt crossed laptops. Impostors on the owner's own laptop are harder to catch (AUC 0.76) than impostors on another laptop (0.85), so part of the separation comes from the device. Ranges are 95% participant-bootstrap intervals; with 8 people they are wide, and in line with the 10–20% error rates published for short tasks (section 2.2).

#### Model questions, measured (`scripts/experiments.py`, Sat 6:50 PM, same 10 people)
All held-out, one probe round, AUC with 95% ranges. Report: `artifacts/reports/experiments.json`.

| Question | Result | What it means |
|---|---|---|
| Does training on more people help a new person? | B0 flat: 0.78 → 0.79 from 2 to 8 training people. M2 rises: 0.69 → 0.77 → 0.81 → 0.83 | B0 only learns feature spreads, so more people barely matter. The learned model is still improving at 8 people, so recruiting is what makes M2 worth switching to. 10 people cannot say where it levels off; SapiMouse (120 people) can |
| How much enrollment is enough? | 1 round (~18 s) 0.75–0.78; 3 rounds 0.75–0.79; 6 rounds 0.80–0.85 | More enrollment helps a little; one session of 6 rounds is the best measured |
| Does a second session matter? | Probe from the same sitting: B0 0.91 (EER 13%). Probe from the second session: B0 0.75 (EER 32%) | Testing inside one sitting overstates accuracy badly. Every second session here was also on another laptop, so this mixes "another day" with "another device" |
| Can a few seconds of movement work (passive login)? | 2 clicks (~1.5 s) 0.70; 4 clicks (~3 s) 0.67; 8 clicks (~6 s) 0.78; clicks and drags (~11 s) 0.83; full round (~18 s) 0.80 | The movement on a login page alone is weak (EER ~37%). It can only be a prior that accumulates across logins and in-app use, with the challenge as step-up |

#### SapiMouse, 120 people (`scripts/sapimouse.py`, Sat 8:00 PM)
Free-form mouse use, a 3-minute enrollment and a 1-minute probe session per person, geometry-free stroke features (block K, `features/strokes.py`), 5 participant-grouped folds, AUC with 95% ranges. Report: `artifacts/reports/sapimouse.json`. Every person used their own computer and both sessions were on the same day, which flatters these numbers.

| Training people | 5 | 10 | 20 | 40 | 96 |
|---|---|---|---|---|---|
| B0-K distance | 0.69 | 0.68 | 0.69 | 0.69 | 0.69 |
| M2-K pairwise boosting | 0.72 | 0.75 | 0.79 | 0.81 | 0.82 (0.80–0.84) |

| Movement per check | 3 strokes (~4 s) | 6 strokes (~9 s) | 12 strokes (~17 s) | 24 strokes (~35 s) |
|---|---|---|---|---|
| B0-K | 0.60 | 0.63 | 0.69 | 0.75 |
| M2-K | 0.74 | 0.78 | 0.82 | 0.87 |

- **More people help the learned model, with diminishing returns:** most of the gain comes by 20–40 training people; 40 to 96 adds 0.01. The distance baseline never improves with more people. This matches the volunteer curve, so recruiting 20+ is what makes M2 worth switching to.
- **More movement per check helps steadily:** about +0.04 AUC each time the movement doubles. Three 12-stroke windows (~50 s) reach 0.88.
- **SapiMouse does not transfer to the challenge:** models trained on SapiMouse alone score the volunteers at AUC 0.70–0.75, no better than block K trained on the volunteers (0.72–0.77), and below the challenge's geometry features (B0 0.80, M2 0.85). Free-form use and the challenge are different tasks. SapiMouse is useful as a scale estimate and as the basis for passive in-app checks, not as training data for the challenge model.

Not measurable yet: whether enrolling on two sessions beats one (needs a third session to probe with), and same-laptop genuine accuracy. **Ask about 5 volunteers for a session C on either laptop**; it answers both.
- [x] A — Replay, expiry, cross-session, grant-reuse and rate-limit tests (36 backend tests)
- [ ] A — Accessibility pass and responsive review in a real browser
- [ ] A+B — README with setup commands and demo steps
- [ ] A+B — Demo rehearsal with a real second person on the same laptop
- [ ] A+B — Record the three-minute demo video (shot list in `DEMO_VIDEO.md`)

### Extensions (only after Gate 3)
- [ ] Adaptive challenge selection
- [ ] Mid-session handoff detection from passive windows
- [ ] Cross-device genuine test beyond 5 people

### How to run
Needs Python 3.11+ with `uv`, and Node 20+ with `npm`.

```bash
# once
cd backend && uv sync && cd ..
npm install

# terminal 1: API on http://127.0.0.1:8000
cd backend && uv run uvicorn cadence.main:app --port 8000

# terminal 2: web app on http://localhost:5173 (proxies /api to the backend)
npm run dev
```

Checks: `cd backend && uv run pytest` and `npm run typecheck`.

**Two entry points.** The product is at `http://localhost:5173/` (sign in, enroll, export). Volunteer collection is at `http://localhost:5173/collect`.

**Collection stations.** Run the whole stack on each collection laptop and open `/collect`. Use localhost, not a LAN address: browsers only expose high-rate pointer samples on secure origins. Set a distinct Station name per laptop and pointing device (for example `nikhil-mouse`, `nikhil-trackpad`). A volunteer uses the same username on every laptop; it lands in the same train/validation/test split everywhere. Recruiting progress: `http://localhost:5173/api/collect/overview`. Data lives in `backend/cadence.db` on each laptop; do not delete it, and copy it somewhere safe before code freeze. **Do not `git pull` or edit files while a volunteer is mid-round:** the dev server reloads the page.

**Training the model.** Snapshot each laptop into `data/collected/` (see the working agreement), then:

```bash
cd backend && uv run python scripts/train.py --db ../data/collected/nathaniels-laptop.db --db ../data/collected/nikhil-laptop.db
```

It evaluates B0, M1 and M2 on participant-held-out scores (about 30 s for 10 people), prints a comparison with 95% ranges, and, if there are at least 5 people with two sessions, activates the selected model under `artifacts/models/`. A learned model replaces B0 only when its paired AUC gain has a 95% interval above zero. Add `--dry-run` to evaluate without activating, `--json` for the whole summary. The running API picks it up on the next request. With too little data it activates nothing and says why.

**Sandbox for development.** To exercise the product before real data exists, train on synthetic players and let the API load that model:

```bash
cd backend && uv run python scripts/train.py --synthetic 40
```

then start the API with `CADENCE_ALLOW_SYNTHETIC_MODEL=1`. The app shows a "Sandbox model" banner whenever such a model is active. Never demo synthetic numbers as results. To run a second stack beside a live collection stack, start another API on port 8001 and the web app with `CADENCE_API=http://127.0.0.1:8001` on another port, from a separate working copy.

### Where things are
| Path | What |
|---|---|
| `backend/cadence/challenges/spec.py` | Challenge spec v1 and layout generator. Frozen after the pilot |
| `backend/cadence/challenges/replay.py` | Server-side replay: validates a submitted round and derives the task timeline |
| `backend/cadence/api/` | Routes: `collect.py`, `challenges.py`, `auth.py` (accounts, consent, fallback), `actions.py` (authorize, export) |
| `backend/cadence/features/extract.py` | 42 movement features per round, shared by the API and training |
| `backend/cadence/verifier/` | B0 (`baseline.py`), M1/M2 (`pairwise.py`), held-out evaluation and bootstrap (`evaluation.py`), weighted metrics, training and model selection, artifacts |
| `data/collected/` | Shared snapshots of each collection laptop's database (tracked on purpose) |
| `backend/cadence/policy.py` | The four outcomes and how a score becomes one |
| `backend/cadence/product.py` | Enrollment profile, trust window, action grants |
| `backend/scripts/train.py` | Train, evaluate and activate a model |
| `backend/scripts/experiments.py` | Learning curve, enrollment size, second session, short-interaction experiments |
| `backend/cadence/collect.py` | Participant codes, checksum, split assignment |
| `backend/cadence/synthetic.py` | Synthetic pointer player for tests. Never evidence about people |
| `packages/sdk/src/` | Capture SDK. `geometry.ts` must stay in step with `spec.py` and `replay.py` |
| `apps/web/src/challenge/` | Challenge surface |
| `apps/web/src/collect/` | Collection mode screens |
| `apps/web/src/product/` | Product screens: sign-in, customers, export flow, movement profile |

Lane B starts from `samples` rows: `events_z` is zlib-compressed JSON of `[t_ms, x, y, kind, buttons]` (kind 0 move, 1 down, 2 up), and `timeline_json` holds the server-derived start and end time of every task, so feature code never has to re-detect clicks.

### Decision log
| When | Decision | Why |
|---|---|---|
| Sat 2:30 PM | Fallback is simulated and labelled demo-only | Saves 2–3 hours for the model and evaluation |
| Sat 2:30 PM | SapiMouse used, reported separately from volunteer data | 120 people gives a real unseen-user estimate before volunteers arrive |
| Sat 6:00 PM | Collected data shared as `data/collected/<station>.db`; the live `backend/cadence.db` is never tracked | A tracked live database is overwritten by every pull on a collection laptop |
| Sat 6:20 PM | Evaluate with participant-held-out cross-validation, not the fixed 60/20/20 split | With 10 people the fixed split left 6 genuine validation attempts, too few to set thresholds; cross-validation uses every person for testing without leakage |
| Sat 6:20 PM | A learned model replaces B0 only if its paired AUC gain has a 95% interval above zero | Picking the best point estimate on 8 people would mostly pick noise |
| Sat 2:30 PM | Vite SPA, not Next.js | Brief dictates React + TypeScript with a FastAPI backend; no server rendering needed |
| Sat 2:30 PM | Trajectories resampled to 60 Hz; no raw timing or step-size features | Stops the model learning the device instead of the person |
| Sat 3:00 PM | Challenge expiry is 120 s, not the planned 90 s | Slow trackpad users must not lose a round; a round is about 20 s |
| Sat 3:00 PM | Server replays every round from raw events and trusts no client claim about hits | One source of truth for validation and for feature segmentation |
| Sat 3:10 PM | Split is blocked 3/1/1 per five volunteers and is a pure function of the code | Balanced with only ~20 people, and consistent across separate laptops |
| Sat 3:20 PM | Pointer moves capped at 250 Hz in the SDK | Bounds payloads on gaming mice and keeps polling rate out of the data |
| Sat 3:40 PM | A failed submission still consumes its challenge | Stops retrying trajectories against one layout |
| Sat 3:50 PM | Tracking ends on a timer, not the animation loop | Browsers pause animation frames in hidden tabs |
| Sat 4:20 PM | Tasks reskinned as a dig site, artwork only | More fun for volunteers; geometry and rules unchanged, server still accepts the same rounds |
| Sat 4:20 PM | Everyone commits and pushes to `origin/main` automatically after each working change | Two people and assistants working in parallel need the latest code and tracker |
| Sat evening | Volunteers choose their own username; generated codes removed | Easier to remember than a code. Costs: typos and two people picking the same name, guarded by the first-time/returning check and a near-duplicate report at export; split balance is no longer guaranteed |
| Sat evening | No minimum break between sessions | More volunteers finish two sessions. Cost: back-to-back sessions are less independent, so the gap is reported with the results |
| Sat evening | First model is the B0 distance baseline only, built by lane A | The product loop needs something to score with before lane B's models exist; M1 must beat it to replace it |
| Sat evening | A model trained on synthetic players loads only with `CADENCE_ALLOW_SYNTHETIC_MODEL=1` and always shows a banner | Lets the flow be developed and rehearsed without ever passing synthetic numbers off as results |
| Sat evening | Verification rounds are never added to the profile; enrollment needs trust at issue and at submit | Unverified activity must not be able to drift the owner's baseline |
| Sat evening | Game restyled from cartoon to a flat survey sheet; spec v1 and artwork frozen | Requested polish done before volunteers start, so every volunteer sees the same stimulus. The 18 pilot rounds predate the restyle and stay excluded as pilot data |
| Sat night | Passive typing and pointer checks with no game, on branch `no-game` | Keyboard timing on 1,000 Aalto typists (AUC 0.964 per 50 keys) beat pointer data per second of activity; the game added friction |
| Sun 1 AM | `main` becomes Cadence as a third-party second factor (no-game merged in; game history kept) | The product is a service other sites plug in: setup happens on Cadence, partners only send evidence from their own sign-in and actions |
| Sun 1 AM | Setup is a click test, a copy-typing test and repeat sign-ins; partners never ask for extra activity | Most of the profile is collected once; a sign-in's own typing (15–45 keys) is scored by a separate login model (AUC 0.932, same-sitting caveat) |
| Sun 1 AM | Partner browser sends evidence straight to Cadence for an opaque token; partner servers decide with a secret | The partner never holds behaviour data; tokens are single use and bound to the site |
| Sun 1 AM | Unsure checks get a personalised test: the input whose own profile samples sit furthest above the pass mark | Asks each person for the evidence most likely to settle it for them, with the demo authenticator always available |
| Sun 1 AM | Only verified checks are learned, and never a check that looked like someone else, even after the person confirms | Profile contamination measurably hurts later checks (CS2 paper, section 2.1) |
| Sun 1 AM | The three passive models are committed under `artifacts/models/` | A fresh clone must work without the datasets; about 120 KB each, trained on research datasets with attribution |
| Sun 2 AM | Setup drops the repeat Cadence sign-ins. After connecting a site, the person types that site's own email and password 3 times (practice sign-ins); the partner checks the password, Cadence gets timing only | Sign-in samples should be the text actually typed at that site. Practice is open 30 min after linking, 8 tries, and a sample that does not match the typing-test profile is turned away so someone else with the password cannot seed it |
| Sun 2 AM | Comparing a sign-in with earlier sign-ins on the same site is built but off | On 1,000 Aalto typists, adding it to the sign-in model gained AUC +0.001 (3 earlier) and +0.002 (5 earlier), and alone it was worse (0.919 and 0.927 against 0.932), so no model was saved (`artifacts/reports/aalto-history.json`). Aalto never repeats text, while real sign-ins do; it switches on by itself if a model measured on repeated text is added to `artifacts/models/keys-history/` |
| Sun 2 AM | Northwind's sign-in is two screens (email, then password), and practice uses the same form | Matches common sign-in pages so practice and real sign-ins are typed the same way. It adds only one or two clicks, far below the 8 the click model needs, so it does not add click evidence |

## 13. Path to a real product (for the pitch and README)
- Position as a step-up risk signal beside device and network signals, in the category of BioCatch and BehavioSec. The business metric is how many genuine sessions avoid a step-up prompt at a fixed impostor pass rate.
- Needs hundreds of users and weeks of data to measure drift; separate profiles per input device; fusion with other signals.
- Open risks: generative imitation and bots, fairness for users with motor impairments, and biometric-data law (GDPR special category, Illinois BIPA) requiring consent, retention limits and deletion.

## 14. Sources
- [Dexerto on the NTNU CS2 thesis](https://www.dexerto.com/counter-strike-2/cs2-player-writes-masters-thesis-on-how-to-ban-cheaters-forever-instead-of-just-accounts-3416037/), [PC Gamer](https://www.pcgamer.com/hardware/counter-strike-2-player-dedicates-masters-thesis-to-rooting-out-cheaters-creates-grade-a-player-tracking-system/), [Yahoo Tech](https://tech.yahoo.com/gaming/articles/masters-student-builds-anti-cheat-145952640.html)
- [Account Consistency from Gameplay Traces, arXiv 2608.24893](https://arxiv.org/html/2608.24893v2)
- [Mouse Dynamics Behavioral Biometrics: A Survey, arXiv 2208.09061](https://arxiv.org/pdf/2208.09061)
- [Jorgensen & Yu, On mouse dynamics as a behavioral biometric](https://elmi.hbku.edu.qa/en/publications/on-mouse-dynamics-as-a-behavioral-biometric-for-authentication/)
- [SapiMouse dataset](https://www.ms.sapientia.ro/~manyi/sapimouse/sapimouse.html), [SapiMouse code](https://github.com/margitantal68/sapimouse)
- [Adversarial Attacks on Remote User Authentication Using Behavioural Mouse Dynamics, arXiv 1905.11831](https://arxiv.org/pdf/1905.11831)
- [NIST slides on Rule of 3 and Rule of 30](https://www.nist.gov/document/iyer-presentationpdf), [FIDO Biometrics Requirements](https://fidoalliance.org/specs/biometric/requirements/Biometrics-Requirements-v1.1-fd-20190606.html)
- [MDN getCoalescedEvents](https://developer.mozilla.org/docs/Web/API/PointerEvent/getCoalescedEvents), [MDN pointerrawupdate](https://developer.mozilla.org/docs/Web/API/Element/pointerrawupdate_event), [Chrome: aligned input events](https://developer.chrome.com/blog/aligning-input-events)
- [MadHacks](https://www.madhacks.io/)

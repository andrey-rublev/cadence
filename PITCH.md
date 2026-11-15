# Cadence: three-minute video and presentation

Prepared November 15, 2026 after pulling `origin/main` at `dea3f11`. This is a content guide, not a word-for-word script. Both versions tell the same story; the video follows the product, while the presentation uses four slides around a live demo.

## The story to keep

**Someone knowing your password shouldn't automatically make them you.** Cadence adds a behavioural check to the sign-in a person is already doing, and asks for more evidence when it cannot make a confident decision.

Make it about a familiar moment: someone gets your work password and tries to reach customer data. The company can check the password, but it needs another signal about who is at the keyboard.

- Set up on Cadence once with a short clicking exercise and given typing prompts.
- Connect a company account and practise that company's own sign-in.
- On later sign-ins, use ordinary typing and available pointer activity instead of immediately asking everyone for another code.
- When the evidence is uncertain or unlike the owner, ask for a short test selected from that person's profile, with another verification path available.

**The differentiator:** a reusable service that connects passive checks, personalised step-up, and server-enforced decisions. Behavioural biometrics itself is established research; don't present it as something we invented.

Optional origin, one sentence at most: the idea started with research about recognising Counter-Strike players from their movements, which made us wonder what ordinary web interactions could reveal. Do not borrow gaming accuracy figures to describe Cadence.

## Three-minute video: screen recording with both of you speaking

| Time | Show | Larger talking points |
|---|---|---|
| 0:00–0:20 — 20 s | Northwind sign-in, then its customer records | A stolen password looks valid to a login form. The question is whether the person using it behaves like the account owner. Introduce Cadence as an additional risk signal. |
| 0:20–0:40 — 20 s | Brief setup clips: circles, given sentence, connected Northwind account | Most deliberate collection happens during setup. The company keeps its own login; users practise its credentials on its own form. Skip through setup rather than recording every repetition in real time. |
| 0:40–1:15 — 35 s | Owner types a normal Northwind sign-in; show the actual verdict | Cadence checks the interaction already happening. If consistent, no extra test. Password contents are not sent in the behavioural payload. Show the verdict, rather than just arriving at the dashboard. |
| 1:15–1:55 — 40 s | Second teammate uses the same demo credentials; show the real result and verification page | Same password, different person. Suspicious or uncertain evidence prompts verification. Point out the recommended typing or clicking test: the choice is based on the owner's profile. A hold is a request for more evidence, not a definitive accusation. |
| 1:55–2:20 — 25 s | Owner completes the recommended test and returns; briefly show the export builder or a prepared export record | The owner has a way forward. The same integration can protect sensitive actions such as exporting customer records. The partner server checks the result before releasing the action. |
| 2:20–2:45 — 25 s | Cadence measured-results page, with one clearly labelled research result | Short sign-in model: ROC AUC 0.932 on 1,000 held-out Aalto typists. These were same-sitting sentence fragments simulating login-length typing, not a field trial of real passwords. Uncertainty is part of the product design. |
| 2:45–3:00 — 15 s | Dashboard showing connected site and recent checks | End on the benefit: fewer interruptions when behaviour matches, another check when it doesn't. Next: multi-day real-login evaluation and a real passkey fallback. |

Total: **180 seconds**. Setup clips may be edited; show verification outcomes honestly. If an attempt is staged or replayed, label it. Don't edit an uncertain owner result into an apparent automatic pass.

Suggested split: teammate 1 covers the problem, setup and owner journey; teammate 2 covers the suspicious attempt, technical distinction and evidence. One person can drive the whole recording so the cursor and pacing stay consistent.

## Three-minute presentation: four slides plus one live demo

Use the same problem, account, and example as the video. Slides carry the ideas; the demo supplies the proof. These bullets are prompts for you, not paragraphs to read aloud.

### Slide 1 — “Right password. Wrong person.”

**0:00–0:25 — 25 seconds.**

On the slide:

- Passwords verify a secret; we want another signal about who's using it.
- Cadence checks how you type and click.
- Ask for more evidence when the signal is unclear.

Visual: a simple company sign-in leading to “Is this the owner?” Avoid a breach statistic that needs explaining. Describe one person losing control of their work account so the stakes feel real.

### Slide 2 — “Set up once. Keep using your company's login.”

**0:25–0:45 — 20 seconds.**

On the slide, three steps:

1. Set up your profile on Cadence.
2. Connect and practise the company sign-in.
3. Normal activity → check → pass or personalised verification.

Mention that Northwind is our fictional partner, running as a separate application. Cadence is an integration, not a replacement company login.

### Live demo — show the contrast

**0:45–2:00 — 75 seconds.**

- **First 25 s:** owner signs into the prepared Northwind account. Point to the actual decision.
- **Next 30 s:** second teammate signs in with the same demo credentials. Show what Cadence decides and the verification route if held.
- **Last 20 s:** show the recommended test and the owner's way back. If completing it will overrun, show a prepared resolved-check record instead and clearly describe it as an earlier run.

Don't create accounts, connect the site or complete setup on stage. Don't add a second full export flow here; one well-explained verification loop is stronger than two rushed ones. Keep the export screen available for questions.

### Slide 3 — “A working integration, with measured limits.”

**2:00–2:40 — 40 seconds.**

On the slide:

- Browser SDK → Cadence evidence token → partner server decision.
- Personalised typing/clicking step-up; decisions enforced on the server.
- **0.932 ROC AUC · 1,000 held-out typists · simulated login-length typing.**

Readable footnote: “Aalto research data; same sitting. Not 93.2% login accuracy. Demo fallback is simulated.”

Talk about what you built across the full loop: two separate sites, collection, scoring, escalation and return. Explain the result as separation between owner and impostor attempts, not a percentage of logins guaranteed correct. The 14.5% equal-error rate is useful in questions, but too much competing numerical detail for this slide.

### Slide 4 — “Less friction when it looks like you.”

**2:40–3:00 — 20 seconds.**

On the slide:

- Use the sign-in people already perform.
- Personalise the extra check when needed.
- Next: real multi-day logins, device changes and passkey recovery.

Finish on the product opportunity: companies can use behaviour to decide when to ask for stronger proof. Acknowledge that a deployable security product needs more validation; the hackathon achievement is the working, measurable loop.

Total: **180 seconds**. Teammate 1: slides 1–2 and owner demo. Teammate 2: second-person demo and slides 3–4. Practise the keyboard handoff once so it feels like a conversation, not alternating memorised paragraphs.

## Capability review: what is actually in the current project

Reviewed the current frontend routes, SDK, backend flows, committed model artifacts and research reports. This table distinguishes implemented behaviour from evidence of real-world effectiveness.

Review checks: **96 backend tests passed**, SDK type checking passed, and both frontend production builds passed after `npm ci` installed the latest dependencies. This review did not re-run the complete two-person browser demo; that rehearsal remains necessary on the judging laptop.

| Area | Current capability | Pitch/demo treatment |
|---|---|---|
| Cadence setup | Account, consent, short target-click exercise, supplied-sentence typing, setup progress | Show briefly in video; pre-complete for presentation. |
| Partner integration | Separate Northwind frontend/backend; approval redirect, one-time link-code exchange, opaque linked subject | Strong differentiator: a service another company can use. OAuth-style linking, not a claim of full standards-compliant OAuth/OIDC. |
| Company-specific practice | Company verifies its own credentials; timed practice window and attempt cap; samples unlike setup profile rejected | Practice is the company's email/password, not repeated Cadence login. Never put real credentials in a recording. |
| Passive sign-in | Short-typing model for login-sized input; standard model for longer typing; available pointer evidence | No extra movement quota imposed on the user. Too little evidence can still mean step-up; two login screens do not create enough clicks by themselves. |
| Decision policy | Consistent, uncertain, inconsistent, insufficient evidence; conflicting inconsistent evidence holds the action | Show the actual outcome; don't call an uncertain attempt a detected attacker. |
| Personalised verification | Own-profile leave-one-out margins recommend typing or clicking; up to two test attempts; fallback route | Implemented recommendation heuristic, not measured proof of optimal test selection. |
| Sensitive actions | Export builder selects customers/fields/audience and collects a reason; CSV download and export log; protected account deletion | Great reserve demo: a meaningful task naturally supplies activity. No need to show deletion during judging. |
| Recent verification | Five-minute default export trust window within the same company session; clearly inconsistent new evidence can cancel it | Don't claim every export always needs a fresh behavioural pass. |
| Learning | Verified evidence can be stored; initially inconsistent original evidence excluded even after recovery; successful test evidence can be learned | Say “builds a verified history,” not “every login measurably improves accuracy.” Short sign-in history affects scoring only when its additional model is available. |
| Data controls | Consent/profile controls, site disconnect with removal of site sign-in samples, account controls; scheduled retention sweep | Profile features persist until deletion; other account evidence/raw data generally expires after 30 days. Volunteer collection follows a separate policy. |
| Developer/security plumbing | SDK activity recorder, direct browser evidence submission, authenticated partner checks, origin checks, expiring single-use evidence tokens, rate limits and browser-bound pending flows | Server enforcement is real. Client-generated evidence is not tamper-proof; an attacker controlling the browser can fabricate it. |
| Evaluation tools | Volunteer collection, snapshot sharing, training/evaluation scripts, baseline comparisons, participant-held-out experiments and bootstrap ranges | Supports an honest research story. Public-dataset performance is not a production security guarantee. |
| Current UI | Redesigned Cadence setup/dashboard/verification/results pages; Northwind customers, exports, security and account pages | Use latest `main`. Earlier `no-game` branch is a different product version. |

### Models: deployed versus experimental

Three model families are committed and available on a fresh clone:

| Model | Recorded research result | Limitation to understand |
|---|---|---|
| Short sign-in typing | Aalto, 1,000 typists; ROC AUC 0.932, 95% interval 0.927–0.937; EER about 14.5% | Sentence fragments of 15–45 keys, last 40% timing-only; same-sitting simulation, not actual repeated company passwords. Use this as the single headline number. |
| Longer typing | Aalto, 1,000 typists; 50-key ROC AUC 0.964; EER 9.9% | Same-sitting research. Useful for typing tests and longer ordinary activity. |
| Pointer | SapiMouse, 120 people; ROC AUC about 0.82; EER about 26% | Device/person confounds and weaker transfer to our own volunteer task. A supporting modality, not the main accuracy claim. |

**Built but not shipped as active model artifacts in this pull:**

- General sign-in-history comparison: code exists, but the Aalto gain of roughly +0.001–0.002 AUC was too small to justify switching it on.
- Position-by-position password rhythm: implementation plus `artifacts/reports/cmu-rhythm.json` exist. The report uses the CMU fixed-password benchmark (51 typists, eight sessions). No `artifacts/models/rhythm/` artifact is tracked, so a fresh clone cannot activate this comparison. Don't promise it in the demo. Its combined product policy has not been evaluated as a whole.

Privacy wording: the behavioural payload uses timing and coarse keyboard zones; secret fields omit key identities. The company still receives its password normally for authentication. Avoid “completely anonymous,” “impossible to infer text,” or “the company cannot access behaviour”: scripts executing on its page remain part of the trust boundary.

## What to leave out of the three minutes

- Full onboarding, dataset downloads, model training or code walkthroughs.
- Every research result, framework name or export configuration option.
- “93% accurate,” “unhackable,” “replaces MFA,” or “definitely detects stolen accounts.”
- Claims that multi-day reliability, device independence or continuous monitoring have been solved.
- A guaranteed green owner result or red second-person result. Rehearse and report what happens.

## Recording and judging preparation

1. Pull `main`, run `npm run setup`, then `npm start`. Cadence: `http://localhost:5173`; Northwind: `http://localhost:5180`; measured results: `http://localhost:5173/results`.
2. Use fictional demo credentials and customer records. Prepare one fully enrolled, linked account with company practice completed. Don't reset profiles or retrain right before recording.
3. Rehearse with the actual owner and second teammate on the judging laptop. Type naturally; autofill/paste supplies little typing evidence. This is a product limitation to acknowledge, not a reason to discourage password managers in real use.
4. Rehearse the specific recommended test and time it. Keep the labelled simulated fallback ready; it demonstrates recovery, not a real independent security factor.
5. Have the export builder and results page pre-opened. First export should be outside the recent-verification window if you want to demonstrate a fresh check.
6. Capture a backup recording of an actual run. If used during the live presentation, identify it as recorded; don't pass it off as live or manufacture outcomes.
7. If the second person passes, say the honest thing: this attempt passed, which is why measured error rates and stronger fallback matter. Then show a labelled earlier held attempt to explain the escalation path. Don't pretend the system caught them.
8. If the owner is uncertain, use the verification path as intended. If the demo runs long, cut the export mention and dashboard tour before cutting the measured-results caveat.

## Likely judge questions: short answer anchors

- **Why not a passkey?** Passkeys are strong authentication. Cadence explores an additional behavioural risk signal and selective step-up; a real deployment should integrate strong authenticators.
- **What is novel?** The end-to-end partner integration and profile-based choice of extra test. We are applying established behavioural research to a usable workflow.
- **What if someone types differently today?** Hold or ask for more evidence; offer another verification method. We still need multi-day/device/accessibility evaluation.
- **Does it learn the attacker?** We exclude initially inconsistent original evidence. Verified learning still needs careful evaluation; no claim that poisoning is solved.
- **Does more history help?** It can provide more evidence, but improvement is not guaranteed. We measured a tiny gain for one history approach and left it off.
- **What would you do next?** Measure real repeated sign-ins over multiple days and devices, report false accepts/rejects at operating thresholds, add real passkey recovery, and harden the integration and data handling.

Source map: `README.md`, `backend/cadence/passive.py`, `backend/cadence/api/sites.py`, `backend/cadence/retention.py`, `backend/partner_demo/main.py`, `packages/sdk/src/activity.ts`, committed `artifacts/models/*/eval.json`, and `artifacts/reports/cmu-rhythm.json`. Older `STATUS.md` demo timings and some capability notes predate the latest pull; use this guide for the three-minute format.

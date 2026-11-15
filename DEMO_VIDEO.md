# Cadence demo video

The plan for the three-minute video: what is on screen, who says what, and how long each clip runs. It follows the same order as the pitch deck: the problem, how Cadence works, the demo, privacy and security, then scaling.

**Cast**

| Who | Plays | Does |
|---|---|---|
| Teammate 1 | Maya, the account owner | Problem, setup, the owner's sign-in and the way back |
| Teammate 2 | Someone with Maya's password | The second sign-in, privacy, the results and what's next |

Use fictional accounts only (`maya` on Cadence at localhost:5173, `maya@northwind.example` on Northwind at localhost:5180). Never show a real password, email or name.

**What to expect.** In a scripted test run, the owner's sign-in went to the verify page ("Not sure yet") and the second person's was marked "Doesn't match" on the Cadence dashboard. The verify page looks the same for both, so the difference shows on the dashboard, and every demo take ends there.

## Before recording

1. Pull `main`, then `npm run setup` and `npm start`. Start with a fresh Cadence account so the setup clip is real.
2. Screen: 1920×1080, Windows display scale 100%, browser zoom 125% (Ctrl +) so text reads on a phone. Full-screen the browser (F11) or hide the bookmarks bar. Turn on Do Not Disturb.
3. Recorder: OBS (Display Capture, 1920×1080, 30 fps, MP4) or Win+Alt+R (Game Bar). Any format works: the edit script converts everything.
4. Microphone: one shared mic close to whoever is talking, quiet room. Record your voice **while** you record the screen, except for clip 02 (see below).
5. Say nothing for the first second of each clip and hold still for a second at the end. That leaves room to cut.

## Shot list

Name each file **exactly** as in the first column (any video extension: `.mp4`, `.mkv`, `.mov`) and put it in `Cadence-presentation\clips\`. Seconds are what ends up in the video; record a bit more and it gets trimmed in the edit. 
| File | Part | In the video | Seconds |
|---|---|---|---|
| *(title card, made by the script)* | | 0:00 to 0:02 | 2.5 |
| `01-problem` | Problem | 0:02 to 0:20 | 17.5 |
| `02-setup` + `02-setup.voice` | How it works | 0:20 to 0:40 | 20 |
| `03-owner-signin` | Demo | 0:40 to 1:10 | 30 |
| `04-second-person` | Demo | 1:10 to 1:45 | 35 |
| `05-way-back` | Demo | 1:45 to 2:10 | 25 |
| `06-privacy` | Privacy and security | 2:10 to 2:33 | 23 |
| `07-results` | Scaling | 2:33 to 2:57 | 24 |
| *(end card, made by the script)* | | 2:57 to 3:00 | 3.5 |

Lines are suggestions at a comfortable pace; say them in your own words, but stay within the seconds.

### 01-problem (Teammate 1, 17.5 s)

On screen: Northwind sign-in page, already signed out. Type the email, Continue, type the password, Sign in, then move the mouse over a few customers. (Record this **after** clip 02 if you want it to go straight in; otherwise it may go to the verify page, so stop at the password step, which is all this shot needs.)

> “This is Northwind’s customer database. If someone steals my password, the login page has no way to tell it isn’t me, and an AI agent with access to my email can read the two-factor code and sign in without me ever knowing.”

Caption added in the edit: *Northwind CRM is a fictional company.*

### 02-setup (Teammate 1, 20 s in the video, about 4 minutes to record)

On screen, one continuous recording, no talking: create the Cadence account, Agree and continue, Excavation (the clicking game), Field notes (copying the sentences), “You’re set up”. Then Northwind: Security, Protect with Cadence, Connect on Cadence, then the three practice sign-ins until “Cadence has learned your Northwind sign-in.”

The script speeds this up to fit 20 seconds and labels it *Setup, sped up*. Because the picture is sped up, record the voice separately as `02-setup.voice.m4a` (Windows Sound Recorder is fine), about 20 seconds:

> “Cadence learns how I type and click once, with a short digging game and a few sentences to copy. Then I connect Northwind, which keeps its own login, and type that password three times so Cadence learns how I sign in there.”

Clips 03, 04 and 05 are one story cut into three, so record them in that order without resetting anything. The owner uses the normal browser window; the second person uses a **private window** (Ctrl+Shift+N), so the owner’s tab stays exactly where it was.

### 03-owner-signin (Teammate 1, 30 s)

On screen, normal window: sign out of Northwind, then sign in typing normally (email, Continue, password, Sign in). Stop on whatever happens.

> “Now I sign in like any other day, and Northwind sends Cadence the timing of what I typed, never the letters.”
>
> **Verify page:** “Cadence wasn’t sure enough this time, so instead of letting me through or locking me out, it asks for a quick test. I’ll come back to that.” Stop recording and **leave this tab as it is** for clip 05.
>
> **Straight in:** “Cadence was sure it’s me, so there’s no extra step.” Move around the customer list for a few seconds.

Caption: *The account owner, typing normally.*

### 04-second-person (Teammate 2, 35 s)

On screen, a private window: Northwind’s sign-in page. Teammate 2 types the **same** email and password in their own way. When the verify page appears (or a Cadence sign-in page, which is the same outcome), hold on it for three seconds. Don’t attempt the test.

> “Now I’m someone else who has Maya’s email and password, and I’m typing them my own way.” (Verify page.) “Cadence holds the sign-in, and to get through I’d have to pass a test built from Maya’s own profile.”
>
> **If it lets you in:** keep the take and say so: “This attempt got through, which is exactly why we measure how often it gets it wrong.” Do not reshoot until it fails.

Close the private window.

Caption: *A teammate, same email and password.*

### 05-way-back (Teammate 1, 25 s)

On screen, the normal window. If 03 ended on the verify page, copy the one field note and land back in Northwind. Then switch to the Cadence dashboard tab, refresh, and rest the mouse on Recent checks: your row (amber “Not sure yet”, confirmed with a quick test) and the private window’s (red “Doesn’t match”).

> “Back to me: I copy one field note and I’m in. On my Cadence dashboard my sign-in is confirmed, and the other one is marked as not matching, so it never gets added to my profile.”

If 03 went straight in, skip the test: start on the dashboard, then open Exports and pick a few customers, stopping before the download (“The same check protects exports, because Northwind’s server asks Cadence before it releases customer records.”).

Caption: *The owner takes the quick test.*

### 06-privacy (Teammate 2, 23 s)

On screen: in a new private window, create a throwaway Cadence account (for example `privacy-demo`) and stop on the consent screen. Rest the mouse on the “meet at noon” example, where “Cadence keeps” shows only a row of bars. Don’t agree; close the window afterwards.

> “This is everything Cadence keeps when you type ‘meet at noon’: when each key went down and how long it was held, but never the letters. We also tested a Chrome extension that copies a person’s mouse and keyboard input, and Cadence still recognized that it wasn’t them.”

If you have a screen recording of the extension test, add it as `06b-extension` and a few seconds of it go under the second sentence.

### 07-results (Teammate 2, 24 s)

On screen: Cadence dashboard, then its **Measured results** link (localhost:5173/results). Scroll slowly to “Typing at sign-in” and hold on the table, then go back to the dashboard and end on Recent checks with all the rows from this recording.

> “Tested on a thousand people it had never seen, it picks the real person over someone else 93% of the time. Any site can add Cadence with a few lines of code, and one profile covers every site you connect. Next we want to test real logins over weeks and devices and add passkeys as a backup.”

## Rules for every take

- Retake for flubs (a typo in the email, a stumble, a notification popping up). **Never retake to get a better decision.** Keep whatever Cadence decided and use the matching line.
- Type everything yourselves; no autofill or paste in any clip.
- Don't edit an owner's “Not sure yet” into an apparent pass.

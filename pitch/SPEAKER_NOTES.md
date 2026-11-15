# Speaker notes

The notes from each slide of the pitch deck, in order. The slides themselves are in [slides.pdf](slides.pdf) and [slides.html](slides.html).

## 1. Problem

Teammate 1, about 25 seconds. Someone gets your work password and the login form lets them in, because the password is right. Two-factor codes don’t stop it either: an AI agent with access to your email can read the code and sign in for itself, and you’d never see it happen.

## 2. Solution

Teammate 1, about 25 seconds. The top screenshot is the clicking game from setup, which is where Cadence learns how you move the mouse. The bottom one is the quick test someone gets when Cadence isn’t sure: here, copying one field note. Mention that sites keep their own login: you just type it a few times when you connect, so Cadence learns how you sign in there.

## 3. Demo

Both, about 75 seconds. Switch to the browser. Northwind is a fake company we built, so say that once.

1. Teammate 1 signs in to Northwind as the owner, typing normally.
2. Teammate 2 signs in with the same email and password.
3. Open the Cadence dashboard and show what it decided for each sign-in.

Whatever Cadence decides, say what actually happened. If the owner gets the quick test, do it. If the second person gets in, say so.

## 4. Privacy and security

Teammate 2, about 30 seconds. The picture is from Cadence’s own consent screen: that row of bars is everything it keeps from “meet at noon”. End on the Chrome extension test: explain what the extension did and that Cadence caught it.

## 5. Scaling

Teammate 2, about 25 seconds, then “thanks” and questions.

The code is the real integration, shortened: the page records typing and gets a token from Cadence, and the server asks Cadence for a decision.

If asked about the number: 93% is how often it ranks the real person above someone else, not the share of logins it gets right. At the setting where it errs equally both ways, it is right about 85% of the time on one sign-in. Our own volunteers dropped from 0.91 to 0.75 when tested on a different day, which is why we say real numbers will be lower.

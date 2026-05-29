# Pakhir Basar Meal Tracker

A Firebase-backed React app for shared-house meal, bazaar, deposit, and cycle tracking.

## Setup

1. Create a Firebase project with Authentication, Firestore, and Hosting enabled.
2. Enable Google as an Authentication provider.
3. Copy `.env.example` to `.env` and fill in the Firebase web app values.
4. Install and run:

```bash
npm install
npm run dev
```

The first Gmail account that signs in becomes the initial admin. After that, add household members from the Members screen.

## Deploy

```bash
npm run build
firebase deploy
```

## Firebase Data Model

- `members`: name, email, role, active status.
- `settings`: current meal rate.
- `cycles`: open and closed accounting cycles.
- `dailyMeals`: one lunch/dinner sheet per date with eaters and optional portions.
- `expenses`: bazaar, utility, and other shared costs.
- `deposits`: member advances added to the shared mess cash fund.

## Verification

```bash
npm test
npm run build
```

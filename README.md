# Pakhir Basar Meal Tracker

A small Firebase-powered web app for managing shared-house meals, deposits, bazaar costs, and monthly balances.

## Goal

Pakhir Basar Meal Tracker keeps everyday mess accounting simple for a shared home. It helps everyone see who ate, how many meals were ordered, who deposited money, and what each person currently owes or has in balance.

## Purpose

Shared meal systems get messy fast when people do not eat every meal, meal boxes are split between multiple people, weekend meals cost more, or multiple admins enter data. This app gives the house one shared place to track meals and money without relying on manual spreadsheets or chat messages.

## Why This Exists

The original use case is a house where lunch and dinner boxes are delivered daily, usually at a fixed rate, but members share those boxes differently each day. Sometimes someone eats half, someone is unavailable, someone pays a deposit, and sometimes the month uses bazaar expenses instead of a fixed meal rate. The app was built to make those calculations visible and less error-prone.

## Features

- Google/Gmail login with Firebase Auth.
- Anyone can create a mess and become its first admin.
- Members can join a mess through one-time invite links.
- Multiple mess support with a mess switcher.
- Admin and member roles.
- Monthly cycles with selected members for each month.
- Static meal rate months for simple fixed-rate tracking.
- Calculated meal rate months for bazaar/expense-based tracking.
- One daily meal sheet per date with lunch and dinner.
- Per-session meal entry with ordered meal count, rate, portions, and skip meal support.
- Temporary remove member from lunch or dinner before using split evenly.
- Submitted-by tracking so multiple admins can see who last saved a meal sheet.
- Member dashboard cards for personal meal count and balance.
- Shared member summary table with meals, deposits, costs, and balance.
- Meal calendar with date details modal.
- Deposits for mess cash fund tracking.
- Bazaar/expense tracking for calculated months.
- Admin member management, role changes, activation, and deletion safeguards.
- Month close flow with confirmation phrase.
- PWA support for Android and iOS home screen install.
- Offline read-only mode with last cached data.

## How To Use

1. Sign in with Google.
2. Create a new mess, or join one using a one-time invite link.
3. If you created the mess, you become the first admin.
4. Add members or create invite links from the People area.
5. Create a new month and choose:
   - `Static` if every meal uses a fixed meal rate.
   - `Calculated` if bazaar/expenses should decide the running meal rate.
6. Select which members should count for that month.
7. Add daily meals from the Meal page.
8. Use Lunch and Dinner sections to set ordered meals, rate, and each member's portion.
9. If someone is not eating that session, remove them temporarily with the cross button, then use split evenly.
10. Add deposits when members put money into the mess fund.
11. For calculated months, add bazaar expenses.
12. Check Home for personal metrics, member summary, and meal calendar.
13. Admins can close the month when the final balances are ready.

## Run Locally

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Fill in the Firebase web app values in `.env`:

```bash
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_USE_FIRESTORE_EMULATOR=false
```

Start the app:

```bash
npm run dev
```

Vite will print a local URL, usually:

```bash
http://localhost:5173
```

## Firebase Setup

Create a Firebase project and enable:

- Authentication
- Google sign-in provider
- Firestore Database
- Firebase Hosting, if deploying with Firebase

Then add a Firebase web app and copy its config values into `.env`.

Deploy Firestore rules:

```bash
firebase deploy --only firestore:rules
```

## Firestore Emulator

To test with the local Firestore emulator, set:

```bash
VITE_USE_FIRESTORE_EMULATOR=true
VITE_FIREBASE_FIRESTORE_EMULATOR_HOST=127.0.0.1
VITE_FIREBASE_FIRESTORE_EMULATOR_PORT=8080
```

Then run:

```bash
firebase emulators:start --only firestore
```

Keep `VITE_USE_FIRESTORE_EMULATOR=false` for production.

## Build

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Deploy

Build first:

```bash
npm run build
```

Deploy to Firebase Hosting:

```bash
firebase deploy
```

## Test

Run unit tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## Main Data Collections

- `messes`: mess/workspace records.
- `members`: users scoped to a mess, with role and active status.
- `invites`: one-time invite links for joining a mess.
- `cycles`: monthly open/closed cycles and closing snapshots.
- `dailyMeals`: one date-level meal sheet with lunch and dinner data.
- `expenses`: bazaar or other mess-fund costs for calculated months.
- `deposits`: member deposits into the shared mess fund.

## Notes

- Offline mode is read-only by design.
- Offline editing and pending sync queues are intentionally not implemented.
- Email notifications are not included yet.
- The app currently focuses on one mess at a time, but one user can belong to multiple messes and switch between them.

# E2E (New Baseline)

New Playwright baseline for `my_pos_store`, designed for manual validation first.

## Principles

- Manual-first execution, not CI-first.
- Small and stable smoke suite.
- Failure artifacts always available (trace, screenshot, video).
- Tag-based filtering to run only what is needed.
- Environment-driven targeting (`dev`, `qa`, `staging`, `prod`).

## Initial Scope

- `@smoke`: frontend reachability and basic API health.
- `@api`: API-only smoke checks.
- `@manual`: curated for manual runs.
- `@critical`: high-value business flows (login valid + login invalid).

## Setup

```powershell
cd e2e
npm install
npx playwright install
```

Create local env file:

```powershell
Copy-Item .env.example .env
```

Accepted env file names:

- .env
- .env.dev, .env.qa, .env.staging, .env.prod
- dev.env, qa.env, staging.env, prod.env

Required variables:

- `BASE_URL`
- `API_URL`

Optional for auth/critical flows:

- `TEST_USERNAME` (or `E2E_USERNAME`)
- `TEST_PASSWORD` (or `E2E_PASSWORD`)

## Dev Commands

Default dev scripts are visible (`--headed`) for manual execution.
The main entrypoint is `npm run test`, which opens Playwright UI for the full dev suite.
The generic filtered commands now also target `dev` by default.

```powershell
cd e2e
npm run test
npm run test:smoke
npm run test:critical
npm run test:dev
npm run test:smoke:dev
npm run test:critical:dev
npm run test:headed:dev
npm run test:ui:dev
npm run test:list:dev

# Optional CI-like mode (headless)
npm run test:dev:headless
npm run test:smoke:dev:headless
npm run test:critical:dev:headless
```

Use `npm run test` when you want to inspect and launch everything from the Playwright UI.
Use `npm run test:smoke` or `npm run test:critical` when you already know the slice you want to run in dev.
Keep the `:dev` variants as explicit aliases and the `:headless` variants for CI-like execution.

## Add New Tests

Use tags in test titles, for example:

- `@smoke @manual`
- `@api`
- `@critical @manual @auth`

Keep smoke tests under 30 seconds and avoid data-heavy setup in smoke.

Pending scenarios are tracked in [TEST-ROADMAP.md](TEST-ROADMAP.md). Check items off there
in the same PR that adds the corresponding spec.

## Authentication — Saved Session

Authenticated tests use a saved browser session stored in `playwright/.auth/user.json`.
This file is generated once by logging in through the UI and persisted on disk.

### Generate / Refresh the auth session

```powershell
cd e2e
npm run test:auth:setup
```

Run this **before** running any authenticated test for the first time, or whenever tests
suddenly fail with `401 Unauthorized` across the board.

### When does the session expire?

The session expires when:

- The backend token TTL is reached (JWT / cookie expiry).
- The dev server was restarted and the session was invalidated.
- Credentials in `.env` changed.
- The `user.json` file was deleted or corrupted.

### Symptoms of an expired session

```
Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

All authenticated tests fail simultaneously — this almost always means the saved
session is stale. Running `npm run test:auth:setup` regenerates it.

### How it works

`scripts/create-auth-state.mjs` opens a real browser, navigates to `BASE_URL/login`,
fills in `TEST_USERNAME` / `TEST_PASSWORD`, waits for the post-login redirect, and
saves the full browser storage state (cookies + localStorage) to
`playwright/.auth/user.json`. Subsequent tests load that state via `storageState` in
`playwright.config.ts` so they start already authenticated.

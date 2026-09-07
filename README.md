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

### Run Against Localhost

The checked-in E2E defaults target the deployed `dev` environment. To run locally, override the
target variables in PowerShell. Keep captcha disabled in the local backend and frontend because
the real Turnstile challenge requires an interactive browser user.

```powershell
cd e2e
$env:E2E_ENV = 'dev'
$env:BASE_URL = 'http://localhost:5173'
$env:API_URL = 'http://localhost:8081/api'
npm run test:auth:setup
npm run test:dev:headless
```

Before starting the local frontend, set `VITE_TURNSTILE_ENABLED=false` in `frontend/.env.local`
and restart Vite. For the local backend, set `APP_SECURITY_CAPTCHA_ENABLED=false` in
`backend/mystore-api/.env`.

To run against deployed dev instead, use the existing `.env` values and omit the localhost
overrides above.

### Production Sandbox Testing

Production E2E is allowed only against the dedicated fake-data tenant and requires an explicit
tenant confirmation:

```powershell
cd e2e
$env:E2E_ENV = 'prod'
$env:BASE_URL = 'https://myposgo.app'
$env:API_URL = '<your-production-api-base>/api'
$env:TEST_USERNAME = '<production-sandbox-user>'
$env:TEST_PASSWORD = '<production-sandbox-password>'
$env:TEST_TENANT_ID = '<production-sandbox-tenant-id>'
$env:E2E_PROD_TEST_TENANT_ID = '<production-sandbox-tenant-id>'
$env:E2E_ALLOW_PROD = 'true'
npm run test:auth:setup:prod
npm run test:prod
```

Create `e2e/prod.env` from the included template and fill in the production API host, sandbox
credentials, and tenant ID. The commands load that file automatically. They refuse to run unless
`TEST_TENANT_ID` equals `E2E_PROD_TEST_TENANT_ID`. Use the dedicated sandbox credentials and data
only. The `test:prod:smoke` command remains available for read-only checks.

### Generate Auth State Against Deployed Dev

Because deployed dev has real Turnstile enabled, generate the saved session in headed mode and
complete the challenge manually once:

```powershell
cd e2e
npm run test:auth:setup
npm run test:dev:headless
```

The generated `playwright/.auth/user.json` is then reused by the authenticated E2E tests. Refresh
it when the session expires or the credentials change. Do not disable captcha in the deployed dev
backend just to make this setup pass.

The auth setup is headed by default. Set `$env:E2E_AUTH_HEADLESS = 'true'` only for an environment
where captcha is disabled or where a pre-solved test token is available.

### Capture Auth From Normal Chrome

The normal command already launches an isolated Chrome profile automatically:

```powershell
cd e2e
npm run test:auth:setup
```

Complete the login and Turnstile in the window that opens. The script then saves the session.

For manual CDP control, use the longer flow below.

If Cloudflare rejects the Playwright-controlled browser, connect Playwright to a normal Chrome
instance through CDP. Close regular Chrome windows first, then start an isolated profile:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
	--remote-debugging-port=9222 `
	--user-data-dir="$env:TEMP\my-pos-store-e2e-chrome"
```

In that Chrome window, the script fills the configured credentials. Complete Turnstile and click
`Ingresar` manually.
Then, from another terminal:

```powershell
cd e2e
$env:E2E_AUTH_CDP_URL = 'http://127.0.0.1:9222'
npm run test:auth:setup
npm run test:dev:headless
```

In CDP mode the script does not fill credentials or click the login form. It only waits for the
manual login to finish and saves the authenticated browser state. The Turnstile token itself is
not reused; the saved session cookies and local storage are what the E2E tests reuse.

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

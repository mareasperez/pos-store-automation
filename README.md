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

```powershell
cd e2e
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

## Add New Tests

Use tags in test titles, for example:

- `@smoke @manual`
- `@api`
- `@critical @manual @auth`

Keep smoke tests under 30 seconds and avoid data-heavy setup in smoke.

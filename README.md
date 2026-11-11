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

## Local inventory quantity rejection

The real-server `tests/inventory/entries/quantity-rejection.real.spec.ts` is authored but
**pending runtime execution**. With the local UI and API already running, a saved local
session for `TEST_TENANT_ID`, and no concurrent catalog edits, run:

```powershell
cd e2e
$env:E2E_ENV = 'local'
$env:BASE_URL = 'http://localhost:5173'
$env:API_URL = 'http://localhost:8081/api'
node scripts\run-playwright-env.mjs --env local tests/inventory/entries/quantity-rejection.real.spec.ts --project=chromium-authenticated --workers=1
```

The environment loader can override shell variables with local env files; ensure both URLs
and tenant match. The test refuses other targets and mismatched saved tenants, and blocks
nonlocal browser requests. It needs an active warehouse, a `UNIT` presentation type, and
permissions to view/create products, view warehouses and create inventory entries, plus
catalog/presentation and stock read access. It creates a uniquely named `QRE-*` product and
presentation and leaves them for inspection; it does not change existing catalog records.
It adds the same factor-2 presentation twice, then changes only that test-owned presentation
to whole-only via the real API. The second row's half quantity would convert to one whole base
unit before the policy change. The test expects the real 400 response and the inline error on
the second row, then corrects the draft without posting it. No inventory entry is intentionally
created; if the API incorrectly accepts the request, an entry and stock movement for the
test-owned product may be created before the test fails. No browser or API execution has yet
been verified.

## Local Combo Lifecycle (C7)

Run only against the already-running, explicitly authorized local UI/API with a valid saved
localhost session, matching `TEST_TENANT_ID` in `local.env`, and an existing open cashier shift:

```powershell
cd e2e
$env:E2E_ENV = 'local'
$env:BASE_URL = 'http://localhost:5173'
$env:API_URL = 'http://localhost:8081/api'
node scripts\run-playwright-env.mjs --env local combo-lifecycle.real.spec.ts --project=chromium-authenticated --workers=1
```

The loader applies `local.env` after default files; ensure its target values match the command.
The spec independently refuses nonlocal targets, a mismatched tenant or nonlocal runtime API,
and blocks external browser requests. It never opens/closes shifts, logs in, or restarts services.
Logging into an unrelated browser does not refresh `playwright/.auth/user-*.json`.

The six real, unmocked scenarios create uniquely prefixed `C7-*` products, service components,
presentations, customers and UI-created combos. They exercise POS sale, multiple whole-combo
returns, duplicate-return rejection, void/resale, quote creation/edit/conversion, eligibility
rejection and aggregate shared-component demand. Raw warehouse base-unit stock and actual
refund/shift-cash results are asserted. Test-owned records intentionally remain for inspection;
each rerun creates new names and prints identifiers. Do not run broad cleanup against the tenant.

Observed on 2026-10-30: **all six scenarios passed, none skipped, retries disabled**.
The final six-scenario run passed five and hit the lifecycle's 180-second overall budget;
one focused lifecycle rerun passed in 3.3 minutes after giving that longer scenario a bounded
300-second budget. The other five retain their 180-second budget. No full-suite rerun was needed.
A changed allocation
correctly blocks the original quote without stock, sale or cash writes. Explicit UI edit previews
and saves the new price, then conversion succeeds with exact persisted inventory and money.
The earlier five-pass/one-failure run had an incorrect test expectation, not an API defect:
changing price and allocations requires editing under the agreed quote contract.
See the root `docs/known-gaps/combo-e2e-lifecycle.md` for evidence.

## Authentication — Saved Session

### Expenses — real serial regressions

Run the real UI/API checks through the existing package runner, configured target,
tenant, and saved login state:

```powershell
npm run test:serial -- --project=chromium-authenticated --grep="@serial.*@expenses"
```

The shared authenticated fixture uses an existing saved worker login; this test does
not perform login setup. Both scenarios require expense/report permissions, an
existing active category and payment method, a configured tenant business time zone,
and no concurrent tenant activity.
The counted scenario additionally requires the actor's already-open shift and an
active counted payment method with a reconciliation entry. It never opens or closes
a shift. Each scenario creates a unique expense and only voids that test-owned record.

| Scenario    | Real assertions / prerequisites                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-counted | Existing active expense category/non-counted method; `expenses:view/create/void` and `reports:view`. UI-created unique expense; editable prior business date; disabled automatic payment time; tenant header and `exp-*` reference; date/category/method/status filters; row and dropdown detail; draft cancellation and outside-click behavior; required void reason, cancellation, state and retained audit. No linked OUT in the actor's existing shift, or no active shift created. |
| Counted     | Same expense permissions plus `shifts:view_all` for associated-shift detail/void reads; the actor's existing OPEN shift with an active counted method/reconciliation entry. UI creation posts exactly one linked OUT, decreases that method's expectation once, and audited void retains that OUT while restoring expectations without an IN.                                                                                                                                           |

Both scenarios also read the real report API around their UI mutations. The
historical `expenseDate` report must gain exactly one row/count and **1.25 in its
own currency**, including the counted case with a linked OUT. The tenant business
time zone comes from existing tenant settings/runtime defaults, never a guessed
report zone. Automatic `paidAt` is checked against today's tenant date; today's
expense report excludes the historical expense. Void restates the original
period's active totals; `includeHistory=true` retains one VOIDED row and its
positive original amount without adding it to totals or posting a negative expense.

Existing `/reports/sales-summary`, `/reports/payment-methods` and
`/reports/sales-by-settlement` responses must remain unchanged after both create
and void. Their fixed **UTC Instant** window starts 48 hours before the snapshot
and ends five minutes after it, covering actual posting even when the tenant's
business date differs from UTC. This follows the existing sales API contract,
not the expense business-date filter. An empty sales window is a valid baseline:
expense creation and void must not introduce sales or payments. No sale is created
or reversed. The counted case also compares actual `salesPayments`
ledger IDs/amounts from the associated shift before/after both mutations.
UI response waits accept the configured API origin or the configured frontend's
same-origin proxy, with a bounded timeout that leaves time for owned-record cleanup.
Creation/audit timestamp comparisons normalize Java Instant nanoseconds to
PostgreSQL's microsecond storage precision instead of requiring identical JSON text.
Sales-summary/payment-method responses use existing backend caching; the
settlement and shift-ledger reads supply uncached corroboration, not direct
PostgreSQL row-level proof.

No expense-report UI or report-specific E2E helper exists in the current checkout;
the cases reuse their isolated real API reader and current backend/frontend report
contracts. Report UI, CSV history/export and broader inventory/credit/operational
report regressions are not covered. ADR 0006 explicitly defines these amount,
date and void expectations; no new reporting business policy was inferred.

Use an isolated test tenant/cashier/shift with no concurrent sales, collections,
expenses, voids or payment-method configuration changes during comparisons.
Only records created by the
current test are voided, including failure cleanup, using the domain void endpoint;
expense/audit/OUT records remain for inspection. A failed/ambiguous creation is
never retried. If the associated shift closes or the session expires, cleanup fails
explicitly and the printed owned ID remains for authorized follow-up; never DELETE
data or open a replacement shift. These cases do not prove closed-shift rejection,
cross-tenant isolation, PostgreSQL atomicity/overlap, rollout or full W09 acceptance.

### Focused local product regression

With the existing local UI/API and valid saved localhost sessions already running:

```powershell
cd e2e
node scripts\run-playwright-env.mjs --env local tests/catalog/products/list-pagination.spec.ts tests/catalog/products/edit.spec.ts --project=chromium-authenticated --workers=3 --fully-parallel --retries=0 --max-failures=1
```

Verify that the environment loader resolves `BASE_URL=http://localhost:5173` and
`API_URL=http://localhost:8081/api` before running; env files override shell values.
Do not refresh sessions or restart services as part of this check. Stop if authentication expires
or a captcha blocks the flow. Product edit tests create unique products, initial stock and
presentations; these records remain for inspection, with no automatic cleanup.

The shared list helper waits for the mounted `products-table` and `aria-busy="false"`, including
the existing empty/error display, rather than treating an absent loading message as readiness.
Pagination targets only `pagination-page-size`; the catalog hook supplies **10, 25, 50, 100**,
overriding the shared component's **10, 20, 50, 100** defaults.
Creation waits positively for `product-form` and its editable name field before checking the
disabled `product-code` input. These use the existing 20-second readiness budget; they do not
remove lazy-module latency or increase global timeouts.

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

### One Cashier Per Worker

Shifts are scoped per user in the backend (`findActiveShiftByUserId`), so every Playwright worker
signs in as a different test user in the **same** tenant. That mirrors production — several cashiers
billing at once — instead of cloning one cashier N times and having it fight over its own till.
Tenant-wide state (stock, numbering sequences) stays shared on purpose: that contention is the
scenario worth testing.

Configure one credential pair per worker in `e2e/.env` (never commit them):

```ini
TEST_USERNAME=<cashier-1>
TEST_PASSWORD=<cashier-1-password>
TEST_USERNAME_2=<cashier-2>
TEST_PASSWORD_2=<cashier-2-password>
TEST_USERNAME_3=<cashier-3>
TEST_PASSWORD_3=<cashier-3-password>
```

All users must belong to `TEST_TENANT_ID` and hold the same POS permissions. `npm run test:auth:setup`
walks through every configured user in a single run — with Turnstile enabled you solve one challenge
per user — and writes `playwright/.auth/user-0.json`, `user-1.json`, ... plus a `user.json` mirror of
slot 0 kept for backwards compatibility.

Workers pick their session by `workerIndex` through the `@fixtures` module, so specs import `test`
and `expect` from `@fixtures` instead of `@playwright/test` (type-only imports still come from
`@playwright/test`). If there are more workers than users, the extras reuse a session and the suite
warns about it.

### Generate Auth State Against Deployed Dev

Because deployed dev has real Turnstile enabled, generate the saved session in headed mode and
complete the challenge manually once:

```powershell
cd e2e
npm run test:auth:setup
npm run test:dev:headless
```

The generated `playwright/.auth/user-*.json` files are then reused by the authenticated E2E tests.
Refresh them when the sessions expire or the credentials change. Do not disable captcha in the
deployed dev backend just to make this setup pass.

The auth setup is headed by default. Set `$env:E2E_AUTH_HEADLESS = 'true'` only for an environment
where captcha is disabled or where a pre-solved test token is available.

### Capture Auth From Normal Chrome

The normal command already launches an isolated Chrome profile automatically:

```powershell
cd e2e
npm run test:auth:setup
```

If Turnstile prompts you, complete only the challenge in the window that opens. As soon as the
`Ingresar` button becomes enabled, the script clicks it, saves the session, and closes the isolated
Chrome window automatically.

For manual CDP control, use the longer flow below.

If Cloudflare rejects the Playwright-controlled browser, connect Playwright to a normal Chrome
instance through CDP. Close regular Chrome windows first, then start an isolated profile:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
	--remote-debugging-port=9222 `
	--user-data-dir="$env:TEMP\my-pos-store-e2e-chrome"
```

In that Chrome window, the script fills the configured credentials. Complete Turnstile if it is
shown; the script clicks `Ingresar` automatically when the button becomes enabled.
Then, from another terminal:

```powershell
cd e2e
$env:E2E_AUTH_CDP_URL = 'http://127.0.0.1:9222'
npm run test:auth:setup
npm run test:dev:headless
```

In CDP mode the script fills the configured credentials, waits for the login form to become
actionable, submits it, and saves the authenticated browser state. The Turnstile token itself is
not reused; the saved session cookies and local storage are what the E2E tests reuse.
Chrome instances supplied through `E2E_AUTH_CDP_URL` remain open because the script does not own
their lifecycle.

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

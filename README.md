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

## Local fractional inventory checks

Two new local-only tests cover inventory independently of sales:

- `fractional-entry.real.spec.ts` uses the real browser to post `0.9725` of an
  owned factor-2 presentation, checks the submitted/persisted quantity and
  verifies exactly `1.945` base units in the selected warehouse.
- `fractional-inventory.api.real.spec.ts` is **API-only**, not UI E2E: default
  whole-only presentations and the eligible factor-2 presentation coexist;
  an eligible factor `0.5`, five-place quantity and fractional sealed box are
  rejected. Entry, departure and fixed-half stock effects are exact.

On 2026-11-13 both tests passed (one worker, no retries): UI 1/1 and API-only
1/1. They require a matching numbered saved local session, an existing active
warehouse and divisible unit, and catalog/inventory create/read permissions.
Run after verifying the effective environment and saved tenant:

```powershell
cd e2e
node scripts\run-playwright-env.mjs --env local fractional-entry.real.spec.ts fractional-inventory.api.real.spec.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=line
```

They create owned `FQE-*` or `FQI-*` records and posted documents, retained
for inspection; they do not modify existing products, flags or shifts. The
browser test allows only the configured localhost UI and API loopback aliases
on port 8081, while blocking external requests, login and token refresh. An
earlier run timed out searching an uppercase barcode; a later passing run used
the product name and did not verify barcode lookup. The selector now matches
barcodes case-insensitively. On 2026-11-13, the original uppercase-barcode
browser path passed 1/1 with one worker and no retries, posting entry 14. The
run's retained marker is `test-results/fractional-barcode-fixed/.last-run.json`.
Owned fixture IDs: `FQE-eb1af79e` product 1082/presentation 1390/entry 14
(uppercase-barcode verification); `FQE-089d092d` product 1072, `FQE-2ecc722e`
product 1073, `FQE-85833a64` product 1074/presentation 1370/entry 5;
`FQI-9e2fea19` product 1067/presentations 1358–1360/entries 3–4/departure 3;
`FQI-14bd358d` product 1075/presentations 1372–1374/entries 6–7/departure 4;
and the final combined run: `FQE-48dfd335` product 1076/presentation 1376/entry 8
and `FQI-0314665a` product 1077/presentations 1378–1380/entries 9–10/departure 5;
final auth-guard run: `FQE-c00b36bc` product 1078/presentation 1382/entry 11
and `FQI-24e2b97b` product 1079/presentations 1384–1386/entries 12–13/departure 6.

These inventory checks are not full W23 acceptance. The bounded commercial
evidence below separately covers sales, quotes and customer returns/voids;
purchase, import, supplier return, fractional combos, promotions and reports
remain outside these checks.

## Local fractional commercial lifecycle — C1–C5

`tests/pos/fractional-commercial.real.spec.ts` adds seven real-server tests:
C1, three C2 datasets, C3, C4 and C5. Primary actions use the browser; API reads
verify persisted state. Ordinary zero-rounded sale rejection, excess return
and duplicate/returned-sale void rejection are explicitly API-only negative guards.
The typed helper is `support/flows/fractional.flow.ts`.

### Observed case evidence — 2026-11-13

| Case                               | Observed result and owned records                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 — precision, capacity and draft | **PASS.** Product 1098/customer 166/sale 685: stock `0.6`, initial quantity `1` and edited `0.7` block checkout; `0.50001` is rejected by the editor. Owned draft reload retains `0.5` and `10.00`; posted quantity `0.5` leaves exact stock `0.1`. API ordinary `0.0001 × 20` line rejects with 400 before sale/payment/stock effects.                                                                                                                                                                                                                                                                                           |
| C2 — exact payments                | **PASS, three datasets.** Sales 686/687: two/four lines of `0.972 × 85.50` save `83.11` per line and totals `166.22`/`332.44`, not aggregate-rounded amounts. Tender `200`/`400` gives exact change `33.78`/`67.56`; each stock becomes `9.028`. Sale 688 additionally proves half-cent boundaries: `0.5 × 0.01/0.03` saves `0.01/0.02`, total `0.03`, tender `1`, change `0.97`, stock `9.5`. Captured POST and saved GET/payment/shift ledgers agree; no automatic sale cash movement.                                                                                                                                          |
| C3 — quote lifecycle               | **PASS for the catalog-ready path; readiness anomaly remains open.** Quote 67 created at `0.9725`, edited to `0.972`, then converted to sale 689. Catalog price `85.50 → 99` and eligibility disable leave history readable at frozen `83.11`; disabled conversion is visibly blocked with no sale/payment/stock effect. Re-enabling permits normal conversion, no manual discount, exact linkage and stock `9.028`.                                                                                                                                                                                                              |
| C4 — discounted partial returns    | **PASS, final linkage-strengthened run 1/1.** Sale 693/returns 141–144: `0.75 × 8 = 6` and `0.5 × 10 = 5`, discount `1`, shares `0.55/0.45`, net `5.45/4.55`, total `10`. Return first line in `0.0001/0.2499/0.25/0.25`: refunds `0/1.82/1.81/1.82`, totaling `5.45`. Sale-time factor `2` restores stock `8.5 → 8.5002 → 9 → 9.5 → 10` after owned factor becomes `3` and eligibility is disabled. Positive refunds have exact linked CASH OUT entries; zero refund has none; original POSTED receipt is unchanged. Server remaining/excess and returned-sale void guards pass; other line remains unreturned, cash net `4.55`. |
| C5 — separate discounted void      | **PASS.** Sale 691/product 1110/customer 172: `0.5 × 23 = 11.50`, discount `0.50`, final charge `11.00`; included tax `1.43`, tax-exclusive header subtotal `9.57`. UI void sets CANCELLED, stock returns `9.5 → 10`, payment ceases contributing to expected cash and financial receipt 646 is VOIDED with one linked OUTBOUND reversal 647 for `11`. Duplicate void returns 400 with unchanged ledgers/stock.                                                                                                                                                                                                                   |

This is bounded commercial evidence, not whole-feature W23 acceptance or release
approval. G4 refund-tax allocation remains deferred; these refund assertions
concern net charged amounts only.

### Commands and chronology

From `e2e`, with the existing authorized stack and saved numbered session:

```powershell
node scripts\run-playwright-env.mjs --env local fractional-commercial.real.spec.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=list --output=test-results\fractional-commercial-local-final
```

Observed **6 passed, 1 failed in 10.1 minutes**: C1, all three C2 variants,
C3 and C5 passed. C4 failed on an unsupported test assumption that a positive
CASH refund must also create a derived receivable ledger trace
(`FinancialMovement` type `RECEIVABLE_CREDIT_NOTE`, origin `RETURN`).
Preserve this failure, screenshot, video and trace under the output directory.
The exact failing expectation was newly added financial amounts `[1.82]`;
actual `[]`. Sale 690's financial receipt 645 remained POSTED `10`;
return 135 was POSTED `0`, return 136 POSTED `1.82`, both with null
`financialMovementId`. Return 136 had linked NIO OUT cash movement 176 for
`1.82`, payment method 11.

The corrected CASH-contract case was then run, before the subsequent review
pause, with:

```powershell
node scripts\run-playwright-env.mjs --env local fractional-commercial.real.spec.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=list --grep C4 --output=test-results\fractional-commercial-local-c4-final
```

Observed **1 passed in 3.5 minutes**, sale 692/returns 137–140. After the
contract distinction was reviewed, C4 was strengthened further to assert each
positive OUT's exact return ID, sale reference, NIO currency and payment method,
and preservation of the original POSTED sale receipt. Its final focused run is
recorded below; no combined 7/7 result is claimed.

```powershell
node scripts\run-playwright-env.mjs --env local fractional-commercial.real.spec.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=list --grep C4 --output=test-results\fractional-commercial-local-c4-linked-ready
```

Observed **1 passed in 4.1 minutes**, sale 693/returns 141–144, products
1115–1116/customer 175 (`FC-6458fc73`). The preceding strengthened attempt
stopped before checkout on POS customer readiness: products 1113–1114/customer
174 only, no sale/return. Its trace showed a 16.1-second products request and
the customer request still pending beyond the original 10-second assertion.
Only that readiness budget was raised to 45 seconds; financial assertions
were not weakened. Preserve its artifacts at
`test-results/fractional-commercial-local-c4-linked`.
The final passing run's artifacts use the output directory above.

Static gates: `npm run typecheck`, scoped ESLint and Prettier checks pass.
These are not application RED/GREEN evidence: early failures also included
test-harness mistakes (a nonexistent presentation factor label/return ID-read
route and treating quote-origin POST as direct-sale lines). No application fix
was made in this batch.

### Safety, retained fixtures and unresolved gaps

The preflight checks effective local URLs, runtime loopback alias, saved
`test-tenant-2` identity, discount permission, empty saved cart/drafts, NIO and
an existing OPEN shift before writes. Browser requests outside the authorized
localhost UI/API origins, including login/refresh, are denied. Fixtures are
unique `FC-*`; only their own presentation policies change. No user cart,
draft, product or shift lifecycle is modified; no login, service operation,
dependency change or global flag rollout is performed. Records remain for
inspection; failed creation requests are not blindly retried.

Combined-run ownership: C1 product 1098/customer 166; C2 products 1099–1106/
customers 167–169; C3 product 1107/customer 170; C4 products 1108–1109/customer
171; C5 product 1110/customer 172. Corrected C4 used products 1111–1112/customer 173;
final C4 used products 1115–1116/customer 175. Earlier attempts retain products 1083–1097/customers 157–165, sales
678–684, quotes 65–66 and returns 130–134. Do not broad-clean the tenant.

- **Quote readiness anomaly:** initial C3 created quote 65 at `0.9725 × 85.50`,
  opened Edit and immediately filled `0.972` before catalog readiness. The PUT
  still sent `0.9725`, saving `83.15`, not `83.11`. The source's quantity handler
  does not update the numeric line until current catalog eligibility exists.
  Final coverage waits for initial Save enabled, checks displayed `83.11` and
  submitted `0.972` before saving. Whether the early interaction is a test
  readiness violation or an application editor race remains unresolved; it
  is not claimed fixed or harmless. Evidence:
  `test-results/fractional-commercial-local-c3-first`.
- **Settlement audit is separate:** the accepted fractional connected proof
  expects CASH refunds through linked OUT movements, not the derived receivable
  ledger trace (`RECEIVABLE_CREDIT_NOTE`, origin `RETURN`, requiring a receivable).
  That enum label does not establish a separate business note requirement.
  The extra expectation was a test assumption, not evidence that the accepted
  CASH contract was rolled back. This does **not** close the partially closed, high-urgency
  [refund settlement gap](../docs/known-gaps/return-refund-currency.md).
  [Settlement documentation](../docs/multicurrency-refund-settlement.md) claims
  a common `return_settlements` audit record not present in the inspected
  Java/migration implementation. Given the parent-verified historical lifecycle
  revert, those retained documents are not authority to restore that architecture.
  Documentation-versus-runtime uncertainty and non-cash ledger/processor/transfer
  evidence remain unresolved. No settlement record or business note requirement
  is invented, restored or waived here.
  Credit returns were **not executed in this batch**: the existing UI exposes
  `APPLY_TO_RECEIVABLE` for an OPEN receivable with no applied payment.
  Credit-sale returns after any applied payment are explicitly unsupported in
  that UI. This source-verified boundary is not additional browser/API proof.
- **Later batch:** fractional combo/promotion/purchase/import/supplier-return
  and report scenarios remain outside this commercial slice, as do remote,
  concurrency, broader permission/tenant and deployment acceptance.

## Local inventory quantity rejection

The real-server `tests/inventory/entries/quantity-rejection.real.spec.ts` is authored but
**blocked by its existing exact-origin preflight**: on 2026-11-13 the runtime
configuration used `127.0.0.1:8081` instead of its required `localhost:8081`;
the run stopped before fixture creation. With the local UI and API already running, a saved local
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
test-owned product may be created before the test fails. The rejection itself remains unverified.

## Local POS manual sale discount

`tests/pos/manual-sale-discount.real.spec.ts` contains two real-server scenarios,
**both locally passed in separate parent-observed runs on 2026-11-13**:

- Required/negative/over-total/sub-cent amount blocking; add and edit with Enter;
  backdrop preservation, Cancel/Escape discard; manual saved-sales disclosure;
  reload and resume of a test-owned discounted draft; clear and zero adjustment.
- Combined fractional checkout: a uniquely created fractional-enabled standard
  product priced at 200 with quantity 0.5, plus a service priced at 50; one sale-wide
  discount of 10, persisted proportional allocations of 6.67/3.33 and total 140.
  The customer receipt must retain gross lines, negative discount sublines and
  saved totals 150/10/140, without the internal reason. The request must not
  contain client per-line manual allocations or price overrides. The saved quantity
  and receipt unit snapshot stay at 0.5, and raw stock decreases exactly from 10
  to 9.5 base units (factor 1).

Run only after explicitly authorizing local financial/catalog mutations:

```powershell
cd e2e
node scripts\run-playwright-env.mjs --env local tests/pos/manual-sale-discount.real.spec.ts --project=chromium-authenticated --workers=1
```

Prerequisites: already-running UI `http://localhost:5173`, API
`http://localhost:8081/api`, explicit `TEST_TENANT_ID`, and a valid numbered
`playwright/.auth/user-N.json` localhost cashier session matching that tenant.
The worker fixture selects numbered auth files, not project `user.json`.
The environment loader overrides shell values with env files even for `--list`;
ensure the resolved local URLs match. Runtime app configuration may use
`http://127.0.0.1:8081` instead. The spec checks targets, runtime API, saved tenant,
discount permission and empty saved cart/drafts before creating records, and
blocks nonlocal browser traffic. It does not log in or change authorization.

Use an isolated NIO test tenant with receipt locale configured, an active `UNIT`
presentation type, an existing divisible presentation type with an abbreviation,
warehouse and NIO CASH method, and an already-open cashier
shift. Required access includes POS sales/create/discount, product and customer
creation, catalog/presentation/stock/promotion reads, warehouse/payment-method
reads and tenant settings. No concurrent catalog, promotion, shift or tenant
configuration changes; test products must not receive automatic promotions.
The spec never opens/closes shifts or resumes/deletes another user's cart/draft.
The dialog scenario creates two `MD-*` services and one unique customer; the
combined checkout creates one `MD-*` standard product (10 initial units) and
one service/customer. Only that new presentation enables fractional quantities;
no existing product, unit policy or tenant flag is changed. Initial stock uses
the product creation API's normal inbound adjustment; the test uses its actual
warehouse and requires product-create initial-stock posting to be available.
The checkout creates one completed cash sale/payment and changes the
existing shift expectation by 140. Records remain for inspection, including on
failure; creation is never retried. The other scenario creates no sale and its
draft stays only in its disposable browser context. The combined scenario covers
fractional POS quantities plus manual discount, not other fractional domains.

Earlier local execution on 2026-11-13 (one worker, zero retries): both scenarios
failed before adding cart lines, waiting for the unique customer's option.
Click-only, typed search and explicit ArrowDown attempts did not expose that
option. The trace confirms `GET /api/customers` returned 200 and included the
test customer; the UI returned to `Publico General`. These were pre-readiness
customer-selection failures, not evidence that discount allocation failed.
Saved localhost authentication, matching tenant, empty saved cart/drafts,
runtime-local API and the existing OPEN shift were verified. No login/setup,
service operations or user-shift lifecycle mutations were performed.

Six unique fixture sets remain for inspection (never broad-clean the tenant):
`MD-ad3b755d` (products 1055/1056, customer 148),
`MD-55922c94` (1057/1058, 149),
`MD-198585bc` (1059/1060, 150),
`MD-178dbae4` (1061/1062, 151),
`MD-0c6acb0b` (1063/1064, 152) and
`MD-02f3f78e` (1065/1066, 153).
Products 1057 and 1061 each received 10 test-owned initial stock units.
Those six attempts reached no sale/payment or discounted draft. Failure screenshots, videos,
traces and HTML reports are retained under
`test-results/manual-discount-local*` and
`playwright-report/manual-discount-local*`; blocked external font requests are
expected from the local-only network guard.

Typechecking and scoped lint/format checks are separate from E2E proof.
Permission-denied actors, frozen quote rejection, IME/Shift+Enter and legacy
receipts remain outside these two scenarios. Subsequent parent-observed runs
passed the dialog/draft case in **44.5 seconds** and the combined fractional +
SERVICE checkout in **42.7 seconds**, creating sale **677** after the authorized
SERVICE fix. That checkout observed quantity `0.5`, stock `10 → 9.5`, shares
`6.67/3.33`, total `140` and gross/negative-discount receipt lines. The customer
input must lose `data-disabled` before typing. These are separate observed
runs, not a claimed repeat or combined run in this commercial batch; the
manual-discount spec is unchanged here.

The directly affected shift specs now use the visible Actions trigger for
readiness and a shared helper to open the menu before Close Shift. Their existing
real lifecycle/reconciliation mutations remain unchanged; do not run them as
part of discount validation against a user's shift.

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

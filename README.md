# E2E (New Baseline)

New Playwright baseline for `my_pos_store`, designed for manual validation first.

## Principles

- Manual-first execution, not CI-first.
- Small and stable smoke suite.
- Failure artifacts always available (trace, screenshot, video).
- Tag-based filtering to run only what is needed.
- Environment-driven targeting. Localhost is the default; remote targets must be selected explicitly.

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
- .env.local, .env.dev, .env.qa, .env.staging, .env.prod
- local.env, dev.env, qa.env, staging.env, prod.env

For `local`, the runner safely defaults to `http://localhost:5173` and
`http://localhost:8081/api`. Other environments require explicit frontend and
API URLs.

Required in each non-local target file:

- `BASE_URL`
- `API_URL`
- `TEST_TENANT_ID` for tenant-scoped real specs

Add `TEST_USERNAME`/`TEST_PASSWORD` (and numbered user variants for parallel
auth setup) when generating authentication state. Existing suites use saved
state only from the selected target.

## Select a target

The generic runner defaults to `E2E_ENV=local` and reads `local.env` or
`.env.local` when present. Select `dev`, `qa`, `staging`, or `prod` explicitly;
the matching `<environment>.env` or `.env.<environment>` file supplies its
URLs, tenant, credentials and any environment-specific gates. Shell variables
remain optional overrides and take precedence over env-file values. Never rely
on a saved session from a different target.

To prepare the selected fractional/manual-discount suite for a dev playground,
configure its ignored `dev.env` or `.env.dev` once, then select that file:

```powershell
cd e2e
npm run test:auth:setup -- --env dev
```

`test:auth:setup` signs in through the configured frontend and writes numbered
Playwright storage states for the target tenant. The three-user setup is needed
for the three-worker daily-use spec; each session must belong to a distinct
cashier with the required permissions and an existing open shift. Refresh
sessions only against the same target. Dev shares tenant/database state with
other playground users, so fixtures are uniquely named and retained; do not
reuse IDs from a prior run or broadly clean the tenant.

Numbered sessions are assigned by Playwright's stable `parallelIndex`, not
the process-specific `workerIndex`. A replacement worker keeps its slot's
cashier even when other tests in a broader run have already failed. Each worker
executes one test at a time and has its own cashier: sessions are never recycled
across concurrent slots. Authenticated workers fail before starting their flows
if there are fewer saved sessions than workers or if the assigned sessions have
missing or duplicate cashier IDs for the configured frontend. Reduce `--workers`
or prepare enough distinct sessions; different filenames alone are not sufficient.
This guarantee is scoped to one Playwright run. Do not launch concurrent runs
using the same cashiers. It does not open shifts, retry financial operations, or
prevent a previous test from leaving its cashier's shift closed. The
daily-use spec still requires three distinct users and does not retry failed
tests automatically.

Then run the selected serial and parallel slices using the existing spec list
and worker settings shown below. Only `--env dev` is needed to select the
configured target; no URL/tenant command-line overrides are required. This
change only makes the suite target-aware;
the 18/18 serial and 3/3 parallel results recorded below were historical local
runs. No dev or production E2E run was performed for this portability change.
The browser target guard validates effective API requests; the lifecycle of
generic and environment-specific app-config artifacts remains deferred in the
[known-gap record](../docs/known-gaps/frontend-app-config-artifacts.md).
Unrelated telemetry and frontend metadata are not business API requests.
Telemetry alone cannot satisfy the probe; application requests to an unexpected
API origin or prefix remain blocked, as do application mutations during the probe.

Production remains separately gated by `E2E_ALLOW_PROD=true` and exact equality
between `TEST_TENANT_ID` and `E2E_PROD_TEST_TENANT_ID`. The runner additionally
permits only the three explicitly selected read-only smoke specs with
`--grep @smoke`; fractional/manual-discount mutation specs are not production
coverage.

## Run Commands

Default scripts are visible (`--headed`) for manual execution and target local
services. The main entrypoint is `npm run test`, which opens Playwright UI for
the default local suite. Use `--env <environment>` to select another configured
target; the selected environment file provides its URLs and tenant settings.

```powershell
cd e2e
npm run test -- --env local
npm run test:serial -- --env local --project=chromium-authenticated
npm run test:list -- --env local
npm run test:auth:setup -- --env local
```

### Offline serial-repair helper checks

These in-memory tests intercept application requests and use synthetic configuration. The preload
guard prevents the helper process from reading local target environment files:

```powershell
$env:E2E_ENV='dev'; $env:BASE_URL='https://ui.example.invalid'
$env:API_URL='https://api.example.invalid/api'; $env:TEST_TENANT_ID='offline-helper-tenant'
$env:NODE_OPTIONS='--require=./tests/helpers/offline-env-guard.cjs'
npx playwright test serial-repair-helper.spec.ts target.flow.spec.ts --config=playwright.helper.config.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=list --output=test-results/serial-repair-isolated
```

`npm run test` selects `@parallel`; `npm run test:serial` selects `@serial`.
For dev, first configure `dev.env` or `.env.dev`, then pass only `--env dev`
to the auth setup and runner. `--list` enumerates tests without starting a
browser or sending requests.

### Isolated shift-helper regressions

The shift readiness helper waits for an actionable open-shift button or the
confirm-sale button, avoiding a stale `isEnabled()` wait when an active-shift
lookup replaces the former. An empty ticket may keep confirm-sale disabled;
its presence still indicates an open shift.

```powershell
node scripts\run-playwright-env.mjs --env local shift-helper.spec.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=list --output=test-results\shift-helper-green
```

These three Chromium checks use in-memory pages, empty authentication state and
an intercepted shift POST. They do not contact an application or change a real
shift. The disappearing-button regression failed before the fix; all three
checks passed afterward. This is helper coverage, not a rerun of the live
credit-sale workflow.

### Isolated customer and quote-catalog readiness regressions

The credit-sale helper waits for an enabled customer combobox, selects the
matching option, and waits for the visible credit-balance state to become ready.
It does not assume that selecting an already-selected customer causes another
network request.

Fractional quote creation and editing wait for catalog loading to finish, with
a 30-second bound and an explicit failure if the form reports a catalog error.
Quantity editing and numeric payload assertions remain unchanged.

```powershell
$env:BASE_URL = 'https://ui.example.invalid'
$env:API_URL = 'https://api.example.invalid/api'
$env:TEST_TENANT_ID = 'offline-helper-tenant'
npx playwright test credit-sales-helper.spec.ts quote-catalog-helper.spec.ts --config=playwright.helper.config.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=list --output=test-results/readiness-isolated
```

This helper-only configuration uses empty in-memory storage and mocked
customer, balance, and catalog requests. It bypasses the environment-file and saved-auth
loader, so the checks cannot reach a configured application target.

## Add New Tests

Use tags in test titles, for example:

- `@smoke @manual`
- `@api`
- `@critical @manual @auth`

Keep smoke tests under 30 seconds and avoid data-heavy setup in smoke.

Pending scenarios are tracked in [TEST-ROADMAP.md](TEST-ROADMAP.md). Check items off there
in the same PR that adds the corresponding spec.

## Fractional and manual-discount acceptance — 2026-11-14

The final frozen-source serial batch passed **18/18 in 18.3 minutes**.
The independent parallel rerun passed **3/3 in 64.9 seconds**, with three
existing users and **40.712 seconds of three-way browser overlap**.
Both runs had zero retries, skips, flaky results or global errors.

| Final check                    | Observed result                                            | Evidence                                                         |
| ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Detailed serial workflows      | 18/18, one worker, nine files                              | `test-results/fractional-final-serial/results.json`              |
| Parallel daily use             | 3/3, workers 0/1/2; actor IDs 5/6/7 in that historical run | `test-results/fractional-final-parallel/results.json`            |
| Readiness UI regressions       | 54/54 across supplier-return and quote form tests          | Focused frontend Vitest run                                      |
| Connected API/Hibernate checks | 4/4, forced offline embedded integration run               | Supplier-return HTTP cases and import ambiguity characterization |

Parallel browser cases independently save/resume/edit a fractional draft,
create/find/edit/reopen a quote, and edit a manual discount before paying and
reopening sale history/receipt. The writer also passed 3/3 in 66.2 seconds;
its browser overlap was independently verified as 30.724 seconds. These are
real concurrent workflows, not merely tests carrying a parallel tag.

The serial set includes **one API-only inventory case**; the other 17 use
browser workflows, with API guards/readback where needed. All runs use
test-owned records and existing saved sessions from the same target. These
historical runs used local sessions. They do not establish
last-unit stock contention, cross-tenant denial or restricted-role denial:
all three authorized sessions belong to the same tenant and have the needed
permissions. No new sessions or roles were created.

The historical import characterization proved the ambiguous lookup failed
without posting. The subsequent factor-matching fix has isolated backend
coverage as described below; these earlier browser runs do not verify it.
The earlier interrupted-import reload initiator remains unconfirmed and did
not recur in the frozen final serial run. Paid-CREDIT return UI paths,
settlement/non-cash audit gaps, broader historical-factor/parity cases and
refund-tax allocation G4 remain outside this bounded acceptance. Passing
this batch is not blanket release approval.

The historical local commands below reproduce the accepted evidence. For dev,
keep the same spec arrays and worker/grep settings, replace `--env local` with
`--env dev`, and use the matching target-specific numbered auth states:

```powershell
$serialSpecs = @(
  'manual-sale-discount.real.spec.ts'
  'fractional-commercial.real.spec.ts'
  'fractional-entry.real.spec.ts'
  'fractional-inventory.api.real.spec.ts'
  'fractional-purchase-supplier-return.real.spec.ts'
  'fractional-combo-promotion.real.spec.ts'
  'fractional-catalog-eligibility.real.spec.ts'
  'fractional-inventory-import.real.spec.ts'
  'fractional-discount-report.real.spec.ts'
)
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = 'test-results\fractional-final-serial\results.json'
node scripts\run-playwright-env.mjs --env local @serialSpecs --project=chromium-authenticated --workers=1 --retries=0 --grep '@serial' --reporter=list,json --output=test-results\fractional-final-serial

$env:PLAYWRIGHT_JSON_OUTPUT_FILE = 'test-results\fractional-final-parallel\results.json'
node scripts\run-playwright-env.mjs --env local fractional-daily-use.real.spec.ts --project=chromium-authenticated --workers=3 --retries=0 --grep '@parallel' --reporter=list,json --output=test-results\fractional-final-parallel
```

Preserve previous reports before rerunning into the same output directories.
Detailed domain proof and earlier failures are retained below.

## Configured-target fractional inventory checks

Two real tests cover inventory independently of sales:

- `fractional-entry.real.spec.ts` uses the real browser to post `0.9725` of an
  owned factor-2 presentation, checks the submitted/persisted quantity and
  verifies exactly `1.945` base units in the selected warehouse.
- `fractional-inventory.api.real.spec.ts` is **API-only**, not UI E2E: default
  whole-only presentations and the eligible factor-2 presentation coexist;
  an eligible factor `0.5`, five-place quantity and fractional sealed box are
  rejected. Entry, departure and fixed-half stock effects are exact.

On 2026-11-13 both tests passed (one worker, no retries): UI 1/1 and API-only
1/1. The historical runs were local. The tests now require a matching numbered
saved session from the configured target, an existing active
warehouse and divisible unit, and catalog/inventory create/read permissions.
Run after verifying the effective environment and saved tenant:

```powershell
cd e2e
node scripts\run-playwright-env.mjs --env local fractional-entry.real.spec.ts fractional-inventory.api.real.spec.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=line
```

They create owned `FQE-*` or `FQI-*` records and posted documents, retained
for inspection; they do not modify existing products, flags or shifts. The
browser test allows only the configured frontend/API origins (and a local
loopback alias only when the runtime actually uses it), while blocking
off-target requests, login, refresh and session creation. An
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

## Configured-target fractional purchase and supplier-return checks

`tests/inventory/fractional-purchase-supplier-return.real.spec.ts` adds two
owned-data serial browser cases. The final focused run observed **2 passed
in 2.2 minutes**, with one worker and no retries:

- **Purchase → sale — PASS.** Product 1139/presentation 1476 used factor 12:
  UI receipt 338 posted `0.5` and increased stock from `10` to `16`; UI sale
  709 posted `0.25` and reduced it to `13`.
- **Supplier return — PASS.** Product 1140/presentation 1478, supplier 300
  and receipt 339 were owned by the test. UI return 4 persisted `0.25`,
  its receipt/supplier/warehouse references and `POSTED` status; stock fell
  from `16` to `13`. A separate whole-only base purchase increased it to
  `14`; API-only five-place and whole-only fractional rejection probes
  then verified unchanged stock and return records.

The original run failed before any return POST because the UI exposed quantity
editing before fractional metadata arrived. The page now gates editing and
submission on catalog readiness and displays catalog errors explicitly; four
new loading/error regressions and the full 28-test component suite passed.
Subsequent automation failures were investigated separately: wait for select
close-focus restoration, and scope purchase rows to the active purchase dialog
rather than a matching background history row. No quantity rule was relaxed.
No cumulative max-returnable assertion is made; the accepted inventory
document contract does not add that rule. Original failure artifacts remain
under `test-results/fractional-stock-docs-local`; final passing artifacts are
under `test-results/fractional-stock-docs-dialog-fixed`.

```powershell
node scripts\run-playwright-env.mjs --env local fractional-purchase-supplier-return.real.spec.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=list --output=test-results\fractional-stock-docs-dialog-fixed
```

## Configured-target fractional catalog, XLSX import and reporting

The three focused serial cases passed in an independent parent run:
**3/3 in 1.5 minutes**, one worker, no retries.

| Case                | Parent evidence                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Catalog eligibility | Product 1172/presentation 1522 persisted through the editor and reload.                       |
| XLSX import         | Product 1174/presentation 1525 verified CREATE/UPDATE and partial failures.                   |
| Report table/CSV    | Sale 727, number `sal-672`, line 818 retained fractional quantity and manual-discount fields. |

The final import case additionally passed **1/1 in 43.5 seconds** with owned
product 1177/presentation 1530. CREATE and UPDATE each accepted one row and
rejected three: missing SKU, five-decimal quantity and whole-only base quantity
`0.5`. Eligibility-specific feedback is asserted. Exact stock remained
`10 → 10.5 → 10.25`; invalid rows did not contribute stock.

One interrupted earlier CREATE did commit; its retained fixture is not reused
for a blind retry. Failure artifacts remain available. The final normal-path
case used distinct base/non-base presentation types and does not verify exact-factor
matching; that backend fix has only isolated-test evidence so far. The E2E XLSX
dependency is direct and test-only; the installation audit was offline, not fresh
vulnerability evidence.

```powershell
node scripts\run-playwright-env.mjs --env local fractional-catalog-eligibility.real.spec.ts fractional-inventory-import.real.spec.ts fractional-discount-report.real.spec.ts --project=chromium-authenticated --workers=1 --retries=0 --grep '@serial' --reporter=list --max-failures=1 --output=test-results\fractional-ops-parent-final
```

### Import presentation matching — isolated backend fix

The earlier import investigation reproduced a real ambiguity: catalog presentations
may share a product and presentation type with different conversion factors,
but the single-result lookup matched only product/type and ignored the workbook's
conversion-factor column, producing HTTP 500.

The original fixture used base/non-base `Libra` presentations at factors
1 and 2, which normal UI creation excludes. However, repeated non-base types
with different factors are permitted, so the distinct-type normal-path fixture
did not resolve or prove this behavior.

The approved backend fix now matches SKU, normalized presentation type, and
exact positive conversion factor. The former failure characterization was
replaced with isolated Hibernate/H2 tests that verify factor-specific selection
in CREATE and UPDATE, numeric scale equivalence, clear rejection of missing,
invalid, unmatched, and ambiguous factors, tenant isolation, partial success,
and exact stock effects.

This is isolated backend evidence only. No local server or live E2E run was
performed after the change, and the earlier browser result covers only the
distinct-type path; live E2E acceptance remains pending.

## Configured-target fractional combos and promotions

`tests/pos/fractional-combo-promotion.real.spec.ts` contains two owned-data
serial browser cases. The writer observed **2/2 passed in 4.2 minutes**;
an independent parent rerun observed **2/2 passed in 4.0 minutes**, with
one worker and no retries.

- Combo creation retains a fractional recipe while the combo count remains
  whole. Browser actions cover sale, quote conversion, customer return and
  separate void. Fractional combo-count and duplicate/returned-sale void
  rejection checks are explicitly API-only.
- Promotion checkout exercises complete qualifying quantities and excludes
  free gifts from manual-discount allocation. The owned promotion is
  deactivated in cleanup; no existing promotion is changed.

Parent-owned records: products 1154–1156, sales 720–721, quote 70 and return
151 for the combo; products 1157–1158, promotion 49 and sales 722–724 for
promotion pricing. This does not cover historical factor changes, whole-only
presentation parity or every lifecycle edge case.

```powershell
node scripts\run-playwright-env.mjs --env local fractional-combo-promotion.real.spec.ts --project=chromium-authenticated --workers=1 --retries=0 --reporter=list --max-failures=1 --output=test-results\fractional-combo-promo-parent-final
```

## Configured-target fractional commercial lifecycle — C1–C5

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
| C3 — quote lifecycle               | **PASS.** Quote 67 created at `0.9725`, edited to `0.972`, then converted to sale 689. Catalog price `85.50 → 99` and eligibility disable leave history readable at frozen `83.11`; disabled conversion is visibly blocked with no sale/payment/stock effect. Re-enabling permits normal conversion, no manual discount, exact linkage and stock `9.028`. The later readiness fix passed two new loading regressions and all 26 form tests; parent real C3 passed again, quote 71 to sale 728, in 1.4 minutes.                                                                                                                    |
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
recorded below. Those focused runs were not a combined 7/7 result; all seven
commercial cases subsequently passed in the final 18-case batch above.

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

The preflight checks the configured frontend/API URLs and runtime API match,
the saved active tenant, discount permission, empty saved cart/drafts, NIO and
an existing OPEN shift before writes. Browser requests outside the authorized
target origins, including login/refresh/session creation, are denied. Fixtures are
unique `FC-*`; only their own presentation policies change. No user cart,
draft, product or shift lifecycle is modified; no login, service operation,
dependency change or global flag rollout is performed. Records remain for
inspection; failed creation requests are not blindly retried.

Combined-run ownership: C1 product 1098/customer 166; C2 products 1099–1106/
customers 167–169; C3 product 1107/customer 170; C4 products 1108–1109/customer
171; C5 product 1110/customer 172. Corrected C4 used products 1111–1112/customer 173;
final C4 used products 1115–1116/customer 175. Earlier attempts retain products 1083–1097/customers 157–165, sales
678–684, quotes 65–66 and returns 130–134. Do not broad-clean the tenant.

- **Quote readiness anomaly — fixed:** initial C3 created quote 65 at `0.9725 × 85.50`,
  opened Edit and immediately filled `0.972` before catalog readiness. The PUT
  still sent `0.9725`, saving `83.15`, not `83.11`. The source's quantity handler
  does not update the numeric line until current catalog eligibility exists.
  Final coverage waits for initial Save enabled, checks displayed `83.11` and
  submitted `0.972` before saving. Source investigation confirmed an
  application editor race: the enabled input stores draft text while missing
  eligibility prevents updating the numeric line; catalog arrival clears
  the error without applying that draft to the saved payload. Quantity editing
  and Save now wait for catalog readiness. Two new delayed-catalog cases
  observed RED before the change; the full form suite passed 26/26, including
  an independent parent run. Parent real C3 passed 1/1 in 1.4 minutes, quote
  71 to sale 728. Original failure evidence remains at
  `test-results/fractional-commercial-local-c3-first`; final browser evidence
  is at `test-results/fractional-quote-readiness-parent-final`.
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

## Configured-target inventory quantity rejection

The real-server `tests/inventory/entries/quantity-rejection.real.spec.ts` was
historically **blocked before fixture creation** because its exact-origin
preflight expected `localhost:8081` while runtime configuration used
`127.0.0.1:8081`. The preflight now validates the configured API target and
allows only a runtime-used local alias. With the selected UI/API already
running, a saved session matching `TEST_TENANT_ID`, and no concurrent catalog
edits, run:

```powershell
cd e2e
node scripts\run-playwright-env.mjs --env local tests/inventory/entries/quantity-rejection.real.spec.ts --project=chromium-authenticated --workers=1
```

The environment loader gives explicit shell variables precedence over env files.
The test refuses mismatched runtime API targets or saved tenants, and blocks
off-target browser requests. It needs an active warehouse, a `UNIT` presentation type, and
permissions to view/create products, view warehouses and create inventory entries, plus
catalog/presentation and stock read access. It creates a uniquely named `QRE-*` product and
presentation and leaves them for inspection; it does not change existing catalog records.
It adds the same factor-2 presentation twice, then changes only that test-owned presentation
to whole-only via the real API. The second row's half quantity would convert to one whole base
unit before the policy change. The test expects the real 400 response and the inline error on
the second row, then corrects the draft without posting it. No inventory entry is intentionally
created; if the API incorrectly accepts the request, an entry and stock movement for the
test-owned product may be created before the test fails. The rejection itself remains unverified.

## Configured-target POS manual sale discount

`tests/pos/manual-sale-discount.real.spec.ts` contains two real-server scenarios,
**both passed in separate parent-observed local runs on 2026-11-13**:

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

Run only against an explicitly authorized target because these cases create
catalog records and a completed sale:

```powershell
cd e2e
node scripts\run-playwright-env.mjs --env local tests/pos/manual-sale-discount.real.spec.ts --project=chromium-authenticated --workers=1
```

Prerequisites: already-running configured UI/API, explicit `TEST_TENANT_ID`,
and a valid numbered `playwright/.auth/user-N.json` session from that same
target and tenant.
The worker fixture selects numbered auth files, not project `user.json`.
Shell values override env-file values even for `--list`. The spec checks the
configured targets, runtime API, saved tenant,
discount permission and empty saved cart/drafts before creating records, and
blocks off-target browser traffic. It does not log in or change authorization.

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
expected from the configured-target network guard.

Typechecking and scoped lint/format checks are separate from E2E proof.
Permission-denied actors, frozen quote rejection, IME/Shift+Enter and legacy
receipts remain outside these two scenarios. Subsequent parent-observed runs
passed the dialog/draft case in **44.5 seconds** and the combined fractional +
SERVICE checkout in **42.7 seconds**, creating sale **677** after the authorized
SERVICE fix. That checkout observed quantity `0.5`, stock `10 → 9.5`, shares
`6.67/3.33`, total `140` and gross/negative-discount receipt lines. The customer
input must lose `data-disabled` before typing. These historical focused runs
were separate; both cases subsequently passed in the final 18-case batch above.
The manual-discount spec is unchanged here.

The directly affected shift specs now use the visible Actions trigger for
readiness and a shared helper to open the menu before Close Shift. Their existing
real lifecycle/reconciliation mutations remain unchanged; do not run them as
part of discount validation against a user's shift.

## Configured-target Combo Lifecycle (C7)

Run only against an explicitly authorized local or dev UI/API with a matching saved tenant and
an existing open shift owned by that cashier. Local remains the default; dev must be selected
explicitly and production mutations remain prohibited:

```powershell
cd e2e
node scripts\run-playwright-env.mjs --env local combo-lifecycle.real.spec.ts --project=chromium-authenticated --workers=1
```

Use `--env dev` only with explicit authorization and matching dev configuration and saved session.
The shared read-only probe checks the effective browser API target before any fixture writes;
the spec verifies tenant, permissions, actor and shift ownership. It never opens/closes shifts,
logs in, or restarts services.
Logging into an unrelated browser does not refresh `playwright/.auth/user-*.json`.

The six real, unmocked scenarios create uniquely prefixed `C7-*` products, service components,
presentations, customers and UI-created combos. They exercise POS sale, multiple whole-combo
returns, duplicate-return rejection, void/resale, quote creation/edit/conversion, eligibility
rejection and aggregate shared-component demand. Raw warehouse base-unit stock and actual
refund/shift-cash results are asserted. Test-owned records intentionally remain for inspection;
each rerun creates new names and prints identifiers. Do not run broad cleanup against the tenant.

Observed locally on 2026-10-30: **all six scenarios passed, none skipped, retries disabled**.
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

Verify that the environment loader resolves the intended URLs before running;
explicit shell values override env-file values.
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

Localhost is the default target. To make the target explicit, set the local
URLs in PowerShell. Keep captcha disabled in the local backend and frontend
because the real Turnstile challenge requires an interactive browser user.

```powershell
cd e2e
npm run test:auth:setup -- --env local
npm run test:serial -- --env local --project=chromium-authenticated
```

Before starting the local frontend, set `VITE_TURNSTILE_ENABLED=false` in `frontend/.env.local`
and restart Vite. For the local backend, set `APP_SECURITY_CAPTCHA_ENABLED=false` in
`backend/mystore-api/.env`.

To run against deployed dev, configure `dev.env` or `.env.dev` once, then use
`--env dev` for auth setup and the runner; no URL or tenant shell assignments
are required.

### Production Sandbox Smoke

Production E2E is allowed only against the dedicated fake-data tenant and requires an explicit
tenant confirmation:

```powershell
cd e2e
node scripts\create-auth-state.mjs --env prod
node scripts\run-playwright-env.mjs --env prod tests\smoke\api.spec.ts tests\smoke\landing.spec.ts tests\smoke\tenant-isolation.spec.ts --grep '@smoke'
```

Use an ignored `e2e/prod.env` or `.env.prod` only when explicitly authorized;
keep its URLs, credentials, tenant IDs, `E2E_ALLOW_PROD=true`, and matching
`E2E_PROD_TEST_TENANT_ID` out of source control. The commands load that file
automatically. They refuse to run unless
`E2E_ALLOW_PROD=true` and `TEST_TENANT_ID` equals `E2E_PROD_TEST_TENANT_ID`.
The runner accepts only the three explicitly selected read-only smoke specs
with `--grep @smoke`; it rejects broad suites and financial mutation specs.
Use the dedicated sandbox credentials and data only. This production gate is
independent of the configured-target fractional suite.

### One Cashier Per Worker

Shifts are scoped per user in the backend (`findActiveShiftByUserId`), so every Playwright worker
signs in as a different test user in the **same** tenant. That mirrors production — several cashiers
billing at once — instead of cloning one cashier N times and having it fight over its own till.
Tenant-wide state (stock, numbering sequences) stays shared on purpose: that contention is the
scenario worth testing.

Configure one credential pair per worker in the selected target file, such as
`e2e/dev.env` or `e2e/.env.dev` (never commit credentials):

```ini
TEST_USERNAME=<cashier-1>
TEST_PASSWORD=<cashier-1-password>
TEST_USERNAME_2=<cashier-2>
TEST_PASSWORD_2=<cashier-2-password>
TEST_USERNAME_3=<cashier-3>
TEST_PASSWORD_3=<cashier-3-password>
```

All users must belong to that environment file's `TEST_TENANT_ID` and hold the
same POS permissions. Run `npm run test:auth:setup -- --env <environment>` to
walk through each configured user in one run — with Turnstile enabled, solve
one challenge per user. The script writes numbered storage states for the
selected target plus a `user.json` mirror of slot 0 for backwards compatibility.

Workers pick their session by `workerIndex` through the `@fixtures` module, so specs import `test`
and `expect` from `@fixtures` instead of `@playwright/test` (type-only imports still come from
`@playwright/test`). If there are more workers than users, the extras reuse a session and the suite
warns about it.

### Generate Auth State Against Deployed Dev

Because deployed dev has real Turnstile enabled, generate the saved session in headed mode and
complete the challenge manually once. Configure three distinct cashier credential pairs first
when running the parallel daily-use cases; see [One Cashier Per Worker](#one-cashier-per-worker).

```powershell
cd e2e
npm run test:auth:setup -- --env dev
$serialSpecs = @(
  'tests\pos\manual-sale-discount.real.spec.ts'
  'tests\pos\fractional-commercial.real.spec.ts'
  'tests\inventory\entries\fractional-entry.real.spec.ts'
  'tests\inventory\entries\fractional-inventory.api.real.spec.ts'
  'tests\inventory\fractional-purchase-supplier-return.real.spec.ts'
  'tests\pos\fractional-combo-promotion.real.spec.ts'
  'tests\fractional\fractional-catalog-eligibility.real.spec.ts'
  'tests\fractional\fractional-inventory-import.real.spec.ts'
  'tests\fractional\fractional-discount-report.real.spec.ts'
)
node scripts\run-playwright-env.mjs --env dev @serialSpecs --project=chromium-authenticated --workers=1 --retries=0 --grep '@serial'
node scripts\run-playwright-env.mjs --env dev tests\pos\fractional-daily-use.real.spec.ts --project=chromium-authenticated --workers=3 --retries=0 --grep '@parallel'
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

# E2E Test Roadmap

Backlog of end-to-end scenarios still missing from the suite.
Current baseline: 66 passing tests across `auth`, `catalog/products`, `customers`,
`suppliers`, `inventory/purchases`, `pos`, `shifts`, and `smoke`.

## How To Use This File

- Pick an item, create the spec under `tests/<module>/<name>.spec.ts`.
- Tag the test title (`@critical`, `@smoke`, `@manual`, plus the module tag).
- Check the item off here in the same PR that adds the spec.
- Keep every scenario self-contained: create its own data, do not depend on run order.

Priority legend:

- **P0** — money/stock correctness. A silent bug here corrupts business data.
- **P1** — daily operational flows.
- **P2** — configuration, reporting, and administration.

---

## P0 — Reversal And Correctness Flows

These are the highest-value gaps: every one of them moves money or stock backwards.

### Selective fractional inventory — local evidence

- [x] Browser entry of `0.9725` at factor 2 retains the submitted and posted
      quantity and adds exactly `1.945` base units: `fractional-entry.real.spec.ts`
      passed 1/1 on 2026-11-13.
- [x] API-only `fractional-inventory.api.real.spec.ts` passed 1/1: exact
      entry/departure stock, independently whole-only sealed/fixed-half
      presentations, and rejection of fractional sealed quantity, five-place
      quantity and fractional eligibility on factor `0.5`.
- [ ] Existing `quantity-rejection.real.spec.ts` stopped at its exact-origin
      prerequisite (`localhost` expected, runtime `127.0.0.1`); no fixture
      created in that run. Its inline stale-policy error is not yet verified.
- [x] Uppercase barcode search selects the owned inventory presentation:
      `fractional-entry.real.spec.ts` passed 1/1 on 2026-11-13 using the exact
      uppercase fixture barcode; product 1082, presentation 1390, posted entry 14.
- [x] Browser purchase of an owned eligible `0.5 × factor 12` presentation
      increased stock `10 → 16`, followed by an owned fractional sale `0.25`
      reducing it to `13` (final receipt 338, sale 709).
- [x] Supplier-return browser submission persisted eligible quantity `0.25`
      against receipt 339, return 4, with stock `16 → 13`. API-only
      precision/whole-only eligibility probes rejected invalid returns without
      effects. Final combined file: 2 passed, 2.2 minutes, no retries. See
      [local purchase and supplier-return evidence](README.md#local-fractional-purchase-and-supplier-return-checks).
- [x] Catalog eligibility, XLSX CREATE/UPDATE partial failures and report/CSV
      normal paths passed independently as a three-case serial batch in
      1.5 minutes. The final import case also rejected whole-only fractions,
      five-place quantities and missing SKUs with exact unchanged rejection
      effects. See [operations evidence](README.md#local-fractional-catalog-xlsx-import-and-reporting).
- [x] Backend import presentation matching now uses SKU, presentation type, and exact
      positive conversion factor. Isolated Hibernate/H2 tests cover CREATE/UPDATE,
      numeric scale equivalence, tenant scope, row failures and stock effects. Live
      E2E acceptance remains pending; earlier normal-path results do not prove the fix.

### Selective fractional commercial lifecycle — local C1–C5

`tests/pos/fractional-commercial.real.spec.ts` uses real browser mutations and
persisted API/stock/payment assertions with uniquely owned `FC-*` fixtures.
The combined run observed **6 passed/1 failed**, not 7/7; C4's unsupported
CASH derived-ledger assertion was corrected and its focused case passed
**1/1** before review. Final strengthened linkage proof passed **1/1 in 4.1
minutes**, sale 693/returns 141–144. Exact commands/IDs
are recorded in [README.md](README.md#local-fractional-commercial-lifecycle--c1c5).

- [x] C1: exact `0.5`, owned draft/reload, stock `0.6 → 0.1`, UI shortage and
      five-decimal rejection; API ordinary zero-rounded paid-line rejection
      with no sale/payment/stock effects (sale 685).
- [x] C2: two/four `0.972 × 85.50` lines, totals `166.22/332.44`,
      exact tender/change and stock; additional half-cent boundary dataset
      (sales 686–688).
- [x] C3: catalog-ready real quote create/edit/read/convert, frozen pricing,
      visible disable block/no side effects, re-enable and linkage
      (quote 67/sale 689).
- [x] C4: discounted fractional cumulative returns and zero-refund increment,
      sale-time factor/eligibility after owned catalog change, exact stock,
      remaining/excess and returned-sale void guards (final sale 693/returns
      141–144). Exact linked CASH OUT entries, zero-refund no-movement and
      original POSTED receipt preservation passed; see README for chronology.
- [x] C5: separate discounted fractional UI void, included-tax header
      reconciliation, one-time stock/payment/financial reversal and duplicate
      rejection (sale 691; financial receipt 646/reversal 647).
- [x] Resolve the quote early-edit readiness anomaly: catalog loading now
      disables quantity editing and Save. Two new cases observed RED; the full
      form suite passed 26/26, including parent verification. Parent real C3
      passed 1/1 in 1.4 minutes (quote 71/sale 728); frozen pricing is unchanged.
- [ ] The separate high-urgency settlement/non-cash audit gap remains partially
      closed. CASH OUT proof is not a new common settlement record or
      derived receivable ledger trace (`RECEIVABLE_CREDIT_NOTE`, origin `RETURN`),
      nor proof of a separate business note requirement. Retained settlement
      documentation versus current runtime remains unresolved; no architecture
      restoration is implied. Credit paths were not tested here.
- [x] Bounded combo/promotion serial browser cases: creation, sale, quote
      conversion, return, separate void and complete-quantity promotion pricing.
      Writer 2/2; independent parent 2/2 in 4.0 minutes without retries. Historical
      factor changes and whole-only presentation parity are not claimed. See
      [combo and promotion evidence](README.md#local-fractional-combos-and-promotions).
- [x] Final frozen-source serial acceptance: **18/18 in 18.3 minutes**,
      one worker, zero retries/skips/flaky/global errors.
- [x] Actual parallel daily-use acceptance: independent rerun **3/3 in
      64.9 seconds**, three existing users, **40.712 seconds of three-way
      browser overlap**; draft save/resume/edit, quote create/find/edit/reopen
      and discounted sale/history/receipt. Zero retries/skips/flaky/global errors.
      Writer also passed 3/3. Final focused UI regressions passed 54/54 and
      connected embedded API/Hibernate checks passed 4/4. See
      [final acceptance evidence and commands](README.md#fractional-and-manual-discount-acceptance--2026-11-14).
      Same-tenant owned-data concurrency does not prove last-unit contention
      or restricted-role/cross-tenant denial. Those earlier normal paths do not
      verify the subsequent import matching fix or close broader lifecycle gaps or G4.

### Fixed-Price Combo Lifecycle — Local C7

`tests/pos/combo-lifecycle.real.spec.ts` uses real local UI/API and unique owned fixtures.
Latest verification (2026-10-30): **all six scenarios passed**, one worker, zero retries/skips.
The final six-scenario run passed five with one 180-second lifecycle timeout; a single focused
lifecycle rerun passed in 3.3 minutes with its budget corrected to 300 seconds.

- [x] Create a combo through the catalog UI and sell it as one commercial line.
- [x] Assert raw physical demand `combo quantity × recipe quantity × presentation factor`;
      SERVICE components never consume physical stock.
- [x] Return whole combo units in two operations; assert refunds, shift cash, stock restoration
      and rejection of an excess/duplicate return without additional stock restoration.
- [x] Void a test-owned resale and sell restored stock again.
- [x] Reject changed quote recipes without sale/stock writes; explicitly edit/reprice the quote
      through the UI and convert using the current recipe.
- [x] Reject inactive and out-of-season saved combos through real checkout without sale/stock writes.
- [x] Prevent two distinct combo lines plus an overlapping standalone nonbase presentation
      from consuming more than their shared physical stock.
- [x] Reject changed allocations on the original quote without stock, sale or cash writes;
      explicitly edit/reprice through the UI, convert at the new price and assert persisted
      quote/sale linkage, exact base stock and shift cash.
      The earlier old-price conversion expectation was incorrect under the agreed edit contract.

### Sales — Void / Cancel

- [ ] Void a cash sale and assert the sale shows as voided in sales history.
- [ ] Void a cash sale and assert stock is returned to the origin warehouse.
- [ ] Void a credit sale and assert the receivable is cancelled (no orphan balance).
- [ ] Void a sale that already has a partial collection — expect a blocking error, not a silent void.
- [ ] Void a sale from a closed shift — assert the documented behavior (blocked or reversed into the open shift).
- [ ] Void requires the matching permission — a user without it does not see or cannot trigger the action.

### Customer Returns (`inventory/returns`, `sales/returns`)

- [ ] Full return of a cash sale — stock back in, credit note/refund generated.
- [ ] Partial return (one line, partial quantity) — remaining balance stays consistent.
- [ ] Return of a credit sale — receivable reduced by the returned amount.
- [ ] Return quantity greater than the sold quantity is rejected with a validation message.
- [ ] Return a line twice — second attempt is limited to the remaining returnable quantity.
- [ ] Returned amount respects the sale's currency and exchange rate.

### Supplier Returns / Purchase Reversal

- [ ] Return goods to a supplier — stock decreases in the receiving warehouse.
- [ ] Return on a credit purchase — payable is reduced.
- [ ] Void a purchase receipt — stock and payable both revert.
- [ ] Cannot return more than what was received on the purchase.

### Payments And Allocations

- [ ] Void a customer collection — receivable balance is restored.
- [ ] Void a supplier payment — payable balance is restored.
- [ ] Overpayment on a collection is rejected or produces an explicit unapplied balance.
- [ ] FIFO allocation preview matches what is persisted after saving.

---

## P1 — Core Operational Flows

### POS / Sell

- [ ] Sale with multiple payment methods (split cash + card).
- [ ] Sale with change calculation — assert the change amount displayed.
- [ ] Credit sale without upfront payment — receivable created for the full total.
- [ ] Credit sale with 100% upfront — treated as immediate, no receivable left open.
- [ ] Sale blocked when there is no open shift.
- [ ] Sale with a product presentation / conversion factor — stock discounted in base units.
- [ ] Sale of a product without stock — blocked or warned per business rule.
- [ ] Draft cart persists after a page reload and can be resumed.
- [ ] Apply a line discount and assert the recalculated total.
- [x] Author local-only manual **sale-wide** discount scenarios
      (`tests/pos/manual-sale-discount.real.spec.ts`): amount validation,
      add/edit/discard/clear/zero, saved-draft reload/resume and disclosure,
      fractional checkout with unequal-line exact-cent allocation, stock decrement
      and customer receipt.
      Earlier customer-selection failures are retained; subsequent separate
      parent-observed runs passed dialog/draft in 44.5 seconds and fractional +
      SERVICE checkout in 42.7 seconds (sale 677). Prerequisites and records are documented
      in [README.md](README.md#local-pos-manual-sale-discount). This does not cover
      line discounts or other fractional-quantity domains.
- [x] Execute both manual-discount scenarios on an explicitly authorized isolated
      local tenant (separate parent-observed runs, not repeated in this batch).
- [ ] Permission-denied and quote-origin nonzero-discount rejection browser
      regressions remain pending.

### Shifts

- [ ] Close a shift with a cash difference (over and short) and assert the reported delta.
- [ ] Shift close summary totals match the sales made during the shift.
- [ ] Cannot open a second shift while one is already open.
- [ ] Reopen / handover behavior between users.

### Inventory Movements

- [ ] Create an inventory entry (`inventory/entries/new`) and assert stock increase.
- [ ] Create an inventory departure (`inventory/departures/new`) and assert stock decrease.
- [ ] Departure larger than available stock is rejected.
- [ ] Transfer between warehouses keeps the global total unchanged.
- [ ] Stock overview report reflects a movement made in the same session.

### Receivables And Collections

- [ ] Register a customer collection against an open receivable — balance decreases.
- [ ] Collection allocated across multiple invoices (FIFO) — each invoice updated.
- [ ] Cash receipt creation and its link to the collection.
- [ ] Receivables list filters by customer and by status.
- [ ] Settlement document (receivable) generation.

### Payables And Supplier Payments

- [ ] Register a supplier payment against an open payable.
- [ ] Payment allocated across multiple purchase receipts.
- [ ] Settlement document (payable) generation.
- [ ] Supplier payment details dialog shows reference, date, and total debt.

### Expenses — real serial regressions

Run with the existing configured target, tenant, saved worker login, and package
runner: `npm run test:serial -- --project=chromium-authenticated --grep="@serial.*@expenses"`.
The 2026-11-05 run reached both cases but stopped before expense creation because
the configured tenant had no paid sale in the recent 48-hour report window. Keep
these items unchecked until the real scenarios pass; discovery is not live proof.

- [ ] UI-create a unique non-counted expense; verify editable business date,
      automatic disabled payment time, tenant-qualified request and `exp-*` reference.
- [ ] Exercise date/category/payment/status filters, row/dropdown detail, draft
      cancellation, outside-click behavior and mandatory audited void.
- [ ] On an explicitly selected pre-existing eligible open shift only, UI-create
      a counted expense, assert one linked OUT and audited void/effective exclusion.
- [ ] Real expense report shows the owned expense exactly once in its original
      business-date period, without double-counting the counted OUT; void restates
      active totals while history retains its positive original amount/status.
- [ ] Today's automatic-payment period excludes the historical business-date expense;
      existing sales summary, posted payment-method and settlement reports remain
      unchanged after create/void, corroborated by counted shift sales-payment IDs.
      Requires an existing paid sale, `reports:view` and no concurrent tenant activity.
- [ ] Complete separately authorized PostgreSQL, closed-shift, permission/isolation
      and rollout regression evidence; these specs do not replace it.

### Catalog

- [ ] Delete / deactivate a product and assert it disappears from POS search.
- [ ] Duplicate product code is rejected.
- [ ] Product search is accent-insensitive (`camion` finds `camión`).
- [ ] Category CRUD and product reassignment.
- [ ] Price checker returns the active price for a scanned code.

### Customers And Suppliers

- [ ] Edit a customer and assert persistence after reload.
- [ ] Duplicate customer document/code is rejected.
- [ ] Customer credit limit blocks a credit sale over the limit.
- [ ] Customer import (CSV) — happy path plus a row-level validation error.
- [ ] Supplier edit and deactivation.

---

## P2 — Configuration, Reporting, Administration

### Settings

- [ ] Payment methods CRUD; a deactivated method disappears from POS.
- [ ] Currencies CRUD and exchange rate applied in a sale.
- [ ] Warehouses CRUD; a new warehouse is selectable in an entry.
- [ ] Presentations CRUD and conversion factor validation.
- [ ] Roles and permissions — assign a role and verify menu visibility changes.
- [ ] Theme settings persist per user across reload.

### Reports

- [ ] Sales report by date range matches sales created in the test.
- [ ] Stock overview report filters by warehouse.
- [ ] Report export (CSV/PDF) triggers a download.
- [ ] Empty-state rendering when the range has no data.

### Users, Team, Organization

- [ ] Create a user, assign a role, and log in as that user.
- [ ] Deactivated user cannot log in.
- [ ] Password reset flow (`/forgot-password` → `/reset-password`).
- [ ] Tenant profile update persists.
- [ ] Platform/admin routes are not reachable by a non-admin user.

### Cross-Cutting

- [ ] Unauthenticated access to a protected route redirects to `/login`.
- [ ] Expired session mid-flow redirects to login without a white screen.
- [ ] 404 route renders the not-found screen.
- [ ] Tenant isolation: data created in tenant A is invisible in tenant B (extend the existing smoke test to sales and stock).
- [ ] Concurrent stock decrement — two parallel sales of the last unit do not oversell.

---

## Known Gaps

Accepted limitations of the current suite. Each one has a mitigation in place and a real fix pending.

### Shift contention between workers (resolved)

Shifts are scoped per user (`ShiftRepository.findActiveShiftByUserId`), not per tenant. Each worker
signs in as a different cashier via `@fixtures`, so no two workers share a till and everything runs
in parallel again.

- **Original symptom**: sporadic `400 DOMAIN_ERROR — No active shift found` on POS sale tests, when
  every worker reused the same `user.json` and one spec closed the shared user's shift.
- **Removed**: the `chromium-shift-exclusive` project and its `dependencies` serialization. The
  `@shift-serial` tag is kept as documentation — those specs really do open/close tills — and
  can still be targeted with `--grep` when you want to run them on their own.
- **Kept**: POS specs re-assert the shift right before each sale POST. Cheap, and it turns any future
  regression into a readable failure instead of a bare 400.
- **By design**: tenant-wide singletons (stock, numbering sequences) stay shared. That contention is
  the production scenario worth testing, not a bug to isolate away.

### Login cannot be automated while Turnstile is enabled

`/api/auth/login` is gated by a real Cloudflare Turnstile challenge on the deployed environments, and
the widget renders inside a closed shadow root (no locator can reach it).

- **Mitigation**: `tests/auth/critical-login.spec.ts` detects the captcha by the request to
  `challenges.cloudflare.com` and self-adapts — it asserts the submit gate when the captcha is on,
  and runs the real login/invalid-credentials flows when it is off. Authenticated sessions come from
  the one-time manual `npm run test:auth:setup`.
- **Real fix**: none needed while the captcha stays on; the specs re-enable themselves automatically
  if `VITE_TURNSTILE_ENABLED` is turned off.

---

## Suggested Order

1. Sales void + customer returns (P0) — biggest correctness gap today.
2. Supplier returns and purchase reversal (P0).
3. Collection/payment voids and allocations (P0).
4. Inventory entries and departures (P1).
5. POS split payments, credit variants, and shift close differences (P1).
6. Everything under P2, as the modules stabilize.

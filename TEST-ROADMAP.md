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

## Suggested Order

1. Sales void + customer returns (P0) — biggest correctness gap today.
2. Supplier returns and purchase reversal (P0).
3. Collection/payment voids and allocations (P0).
4. Inventory entries and departures (P1).
5. POS split payments, credit variants, and shift close differences (P1).
6. Everything under P2, as the modules stabilize.

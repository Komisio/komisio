# Phase P2: sell and settle, as bounded slices

Status: lead-architect specification, 2026-09-12, after the owner answered
open questions 5 to 13 (DECISIONS.md). Depends on P1 (items with frozen
terms, store policy, seller terms). Same conventions as P1-SLICES.md: one PR
per slice, decision lines and pgTAP first, additive migrations, engine
command, thin surface, tests. Money is `numeric` rounded to öre in the
database; corrections are new rows; nothing with financial weight is edited
or deleted.

One rule above all others in this phase: **VAT treatment is a tenant
setting, not a Komisio decision** (owner decision 2026-09-13). The tenant
selects its VAT modes in the store policy with its accountant; the engine
computes every mode deterministically as documented in `docs/VAT-CASES.md`,
freezes mode, basis and amount on each sale line, and refuses to record a
sale for a tenant that has not chosen. Commission and seller credit do not
depend on the mode.

## S10. VAT modes

Purpose: the modes, their arithmetic and their policy keys, before S11.

- `docs/VAT-CASES.md` (done in draft) defines the five modes, basis fields,
  formulas, rounding and the policy keys; the skill holds the reasoning and
  the legal sources a store's accountant would check.
- Pure functions in `lib/engine/vat.ts`, one per mode, integer öre in and
  out, with a worked example per mode in unit tests; a matching SQL function
  `komisio_private.vat_for_line(mode, basis)` with the same examples in
  pgTAP, so application preview and database record cannot disagree.
- Store policy (P1 S1) gains `vatModeConsignmentPrivate`,
  `vatModeStoreOwned` and `vatRatePercent`; the settings page shows the
  modes with plain-language help and the sentence that the choice is the
  store's, made with its accountant.
- No table migration beyond the policy keys. Exit: every mode has a tested
  function in both places and the settings page can select it.
- Status 2026-09-13: arithmetic, mode selection and the policy fragment
  (`vatPolicy` in `lib/engine/vat.ts`, SQL `komisio_private.vat_for_line`)
  delivered. Folding the keys into the store policy body and the settings
  page follows once S1 is merged.

## S11. Sales with lines

Purpose: the sale as a fact from a POS, idempotent, with frozen basis.

- Tables `sales` (tenant, provider, external transaction id unique per
  tenant and provider, currency, occurred_at, total in öre, status
  `completed` | `reversed`, raw provider reference) and `sale_lines` (sale,
  item, price in öre, ownership, commission basis, commission rate,
  commission amount in öre, seller credit in öre, VAT case id, VAT basis
  jsonb, VAT mode, VAT amount, agreement version, seller terms
  version). Both immutable.
- `record_sale(p_tenant, p_id, p_provider, p_external_id, p_occurred_at,
p_currency, p_lines)`: staff or integration actor; every item must be
  accepted and on sale; commission and seller credit computed from the
  item's frozen terms; replay by external id returns the existing sale;
  a different payload under the same external id fails. Marks items sold
  with an event.
- `simulate_sale(...)`: same computation, no write; used by the UI preview
  and by tests.
- Surface: receipts list and receipt detail (thin), agent read tools
  `find receipts`, `get receipt`, `simulate sale`.
- Migration: yes.
- Status 2026-09-13: tables, `record_sale`, `simulate_sale`, engine command,
  counter sale form, receipts list and detail delivered (migration
  `20260914000000`). Commission: inclusive basis takes the rate of the price
  and the seller gets the rest; exclusive basis takes the rate as commission ex
  VAT, adds VAT on the commission invoice and treats the seller as a business
  seller (interim proxy until a seller VAT registration exists). Agent read
  tools follow with the P2 MCP work.

## S12. Zettle sales pull

Purpose: the first POS integration, pull only.

- `extensions/zettle/`: OAuth connection per tenant (client id and key
  stored encrypted, tokens refreshed), pull purchases since a cursor, map
  purchase lines to items by the item reference printed on the label (the
  Zettle product is created from the accepted item in P3; in P2 staff key
  the reference at the till or the mapping table is used), call
  `record_sale` per purchase with the Zettle purchase uuid as external id,
  keep an idempotency and error log, expose sync status and a manual sync.
- Unmatched lines land in an `unmatched_sale_lines` table for staff to
  resolve by choosing the item; resolution calls `record_sale` for that line.
- Surface: integrations page section (connect, status, sync now, unmatched
  queue). Agent tools: sync status, propose match (staged, `low`).
- Migration: yes (connection, cursor, unmatched lines).

## S13. Returns

Purpose: reversal as a new fact.

- Table `sale_returns` (tenant, sale line, reason, refund in öre, occurred_at,
  recorded_by, flagged_for_review boolean with reason). Immutable.
- `record_return(p_tenant, p_id, p_sale_line, p_refund, p_reason)`: full
  refund only in P2; reverses the seller credit with a new ledger entry
  (S14), puts the item back on sale with an event, sets
  `flagged_for_review` when a payout covering that credit was already
  approved or paid. Partial refunds rejected with a clear code.
- Surface: return action on receipt detail; review flag on the payouts page.
  Agent tool `record return` (staged, `medium`).
- Migration: yes.
- Status 2026-09-13: `sale_returns` and `record_return` delivered (migration
  `20260914030000`): full refund only, credit reversal in the ledger, item
  freed for resale, `flagged_for_review` with reason `CREDIT_ALREADY_USED`
  when the seller's available balance no longer covers the credit; return
  form on the receipt, flagged list on the payouts page. The sale row stays
  `completed`; the return is the reversal fact. Staged agent kind follows.

## S14. Seller ledger and balance

Purpose: the append-only ledger every seller-facing number derives from.

- Table `seller_ledger_entries` (tenant, seller, kind: `credit_sale` |
  `credit_reversal` | `payout_reserved` | `payout_paid` | `payout_released` |
  `booking_charge` (P4) | `adjustment`, amount in öre signed, reference to
  the originating row, occurred_at, recorded_by). Immutable; written only by
  engine functions, never directly.
- `seller_balance(p_tenant, p_seller)` read: available = sum of credits and
  reversals minus paid minus reserved; reserved shown separately.
- `adjust_seller_ledger(...)`: owner or admin only, reason required, staged
  kind `adjustLedger` at risk `high` for agents (never auto).
- Surface: balance on the seller view and in the seller app; agent tools
  `get balances`, `get seller balance`.
- Migration: yes.
- Status 2026-09-13: table with per-kind sign checks, `seller_balance`,
  `adjust_seller_ledger` (owner or admin, reason required, replay-safe),
  sale credits written by `record_sale`, balance and entries on the seller
  page with the adjustment form (migration `20260914010000`). The staged
  kind `adjustLedger` and the agent read tools follow with the P2 MCP work.

## S15. Payouts

Purpose: request, approve, pay, with reservation at approval.

- Table `payouts` (tenant, seller, amount in öre, currency, status
  `requested` | `approved` | `paid` | `rejected`, requested_by (seller or
  staff), requested_at, approved_by, approved_at, paid_by, paid_at, payment
  reference, rail `manual` in P2). Status transitions are new rows in
  `payout_events`; the payouts row is updated only through the engine and
  every transition is logged.
- `request_payout` (seller from the app, or staff): amount at most available,
  at least the policy threshold. `approve_payout`: staff, writes the
  `payout_reserved` ledger entry. `mark_payout_paid`: staff, reference
  required, writes `payout_paid` and releases the reservation.
  `reject_payout`: releases the reservation if approved.
- Staged kinds `approvePayout` (`medium`) and `markPayoutPaid` (`medium`).
- Surface: payouts page (thin) with approve and mark paid; seller app
  request and history. Notification by e-mail on approval and payment
  through the communication log (S18).
- Migration: yes.
- Status 2026-09-13: tables `payouts` and `payout_events` with a status guard
  that only engine transitions pass, `request_payout` (staff on the seller's
  behalf, threshold and balance bounded), `approve_payout` (reserves),
  `mark_payout_paid` (reference required, releases and pays),
  `reject_payout` (releases an approved reservation), payouts page with
  request form and decisions (migration `20260914020000`). Seller-app
  requests, e-mail notification (S18) and the staged kinds follow.

## S16. Settlement statements

Purpose: the numbered document.

- Table `settlement_statements` (tenant, seller, number from a per-tenant
  sequence, period, opening balance, sales gross, commission, net, payouts,
  closing balance, generated_at, generated_by, corrected_by_statement
  nullable) and `settlement_statement_lines`. Immutable. A correction is a
  new statement of kind `credit_note` referencing the original.
- `issue_statement(p_tenant, p_seller, p_from, p_to)`: computed from the
  ledger; rendered to PDF by a server-side renderer; stored as an asset;
  delivered by e-mail and by a personal link with the same capability
  pattern as reviews.
- Surface: statements tab on the seller view; seller app statement list.
  Agent tool `get statement` (read), `propose statement issue` (`low`).
- Migration: yes.
- Status 2026-09-13: numbered statements and credit notes computed from the
  ledger (migration `20260914040000`), per-tenant counter, overlap refusal,
  frozen header totals and lines, printable page and issue form on the seller
  page. PDF rendering, asset storage, e-mail and the seller link follow with
  S18 and the seller app.

## S17. Day close and Fortnox export

Purpose: bookkeeping data per day, exported.

- Table `day_closes` (tenant, date, totals per VAT case and per payment
  method in öre, seller liability movement, generated_at, version) and
  `accounting_exports` (day close, provider, idempotency key, status
  `queued` | `sent` | `failed`, attempts, voucher reference, request and
  response payloads). Both immutable; a regenerated day close is a new
  version.
- `generate_day_close(p_tenant, p_date)`: derived from sales, returns,
  payouts of that day, with VAT totals per mode.
- `extensions/fortnox/`: OAuth per tenant, account mapping stored as a
  versioned tenant policy, voucher preview, export with idempotency key,
  reconciliation view, scheduled auto-export as an optional policy.
- Surface: accounting page (day list, preview, export, reconciliation).
  Agent tools `day close preview`, `export day close` (staged, `medium`).
- Migration: yes.

## S18. Notifications and communication log

Purpose: the e-mail-first seller communication decided in P1 answers.

- Table `seller_communications` (tenant, seller, kind, channel `email`,
  template key, subject, body as sent, reference to the triggering row,
  sent_at, provider message id, status). Immutable.
- Templates as versioned code with fixed placeholders and a store-editable
  free-text block; the model may write the free-text block within the
  template; every send goes through the Resend transport already used for
  invitations with the allowlist rules for the pilot.
- Triggers in P2: item accepted, item sold, payout approved, payout paid,
  statement issued. Push is P4.
- Surface: communication tab on the seller view. Agent tool `send message`
  (staged, `low`, template-bound).
- Migration: yes.

## S19. Labels and the local print agent

Purpose: the four templates and the printer path.

- Templates for bag, item, onboarding slip and markdown as ZPL with
  placeholders, versioned in code; `render_label(kind, ref)` in the engine.
- Table `printers` per tenant (name, transport `tcp` | `usb`, address,
  model, dpi) and `print_jobs` (tenant, printer, label kind, reference,
  payload, status, created_at, claimed_at, completed_at, error).
- Local print agent: a small signed executable that authenticates with a
  device token, long-polls `print_jobs` for its printer, sends ZPL over TCP
  or USB and reports completion. Bulk reprint is many jobs.
- Surface: print buttons where the objects are; printers list in settings.
- Migration: yes.

## S20. Lifecycle queue, batch reception, duplicate check, metering, bulk staged ops

Smaller slices that complete P2 and are independent of each other:

- Lifecycle queue derived from items, frozen sale period and markdown steps:
  stages `on_sale`, `markdown_due`, `period_ending`, `period_ended`;
  operations `extend`, `apply_markdown`, `end_of_period` (charity or return)
  with events. Agent proposals for markdown batches at `low`.
- Batch reception: one photo set for one seller; the model splits into
  garments and proposes each; staff confirm per row; the same reception
  contract per garment.
- Duplicate check: image embedding per photo, nearest neighbours in the
  store, candidates shown at reception, dismiss recorded.
- Usage metering: units per feature and tenant on the existing attempt
  records, monthly reset, quota in the store policy.
- Bulk staged operations: price change, status change, reprint for a set of
  items as one operation with a preview.

## Order and exit

S10 first and in parallel with P1's tail. Then S11 → S12 → S14 → S15 →
S13 → S16 → S17, with S18, S19 and S20 in parallel once S11 exists. P2 is
complete when one store can, locally and in staging with synthetic data: pull
a Zettle purchase into a sale with lines carrying frozen basis, see commission
and seller credit, record a full return, see the seller balance change, take
a payout from request through approval to paid with reservation in between,
issue a numbered statement the seller can open, generate a day close and
export it to Fortnox idempotently, print all four labels through the local
agent, and have sellers receive the five e-mails, with VAT computed per line
in the modes the store selected.

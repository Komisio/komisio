# Several stores under one company: design proposal

Status: the owner answered all five questions on 2026-09-15 (yes to step 1;
balance stays where the sale happened; own terms in the target store; owner
or admin in both stores; one plan per store). Step 1 is delivered (migration
`20260916260000`, pgTAP 0096) and step 2, item transfer, as well (migration
`20260916270000`, pgTAP 0097): the item page of a consignment item offers
"Move to another store in the chain" to owners and admins of both stores. The earlier decisions stand: the store is the tenant
(2026-09-10), and a chain shares access only until a chain customer asks
for more (B8, 2026-09-14). komisio.com now lists "several stores under one
company: shared sign-in, moving items between stores with a recorded
handover, reports per store and in total" under "in development now",
which goes beyond access only. The questions below decide how far.

## What exists today

- A user may belong to many stores through `tenant_members` and switches
  between them; the active store is remembered on the profile. That is the
  "shared sign-in" already.
- Every table carries `tenant_id`; RLS, grants and the engine functions
  check membership in that one store. Nothing crosses stores.
- Plans, Zettle, Fortnox, policies, sellers, items, ledgers and day closes
  are per store.

## Proposed shape, smallest first

1. **Chain as a label with reporting.** A `chains` table (id, name, owner),
   `tenants.chain_id` nullable, set by an owner who is owner of every store
   being grouped. New read `chain_economy_summary(chain, from, to)`: the
   per-store economy summaries side by side and a total, for members who
   are owner or admin in every store of the chain. No write crosses stores.
   This is B8 plus reporting, and it is what the site's "reports per store
   and in total" needs.
2. **Moving an item between stores.** An item is a frozen contract with one
   seller under one store's policy and agreement. Moving it is not an
   update; it is an end in one store and an acceptance in another. Proposal:
   engine command `transfer_item(from_tenant, item, to_tenant, request)`
   that, in one transaction, records `period_ended` with action `transfer`
   in the source store, creates a `garment_receipt` with custody source
   `store_transfer` in the target store referencing the source item, and
   lets the target store accept it under its own terms. The seller stays
   the same person: the seller record is copied to the target store if
   absent (same e-mail), with the agreement evidence carried as
   `transfer_from` evidence kind. Both stores keep their own facts; the
   seller's ledger balance stays in the source store until paid out, or
   moves as a ledger transfer pair (debit source, credit target) which is a
   second decision.
3. **Shared sellers.** Not proposed now. A seller registered in one store
   is not visible in another until an item transfer copies the record.

## Questions for the owner

1. Is step 1 (chain label, owner-only grouping, reports per store and in
   total) approved as the first slice? It is additive and does not change
   isolation.
2. For step 2, should the seller's balance follow the item to the target
   store, or stay where the sale happened? Staying is simpler and keeps
   every ledger single-store; following means a ledger transfer pair and a
   statement that spans stores.
3. Should the target store accept a transferred item under its own policy
   and terms (proposed), or inherit the frozen terms from the source? Own
   terms keeps "terms frozen at acceptance" true; inheriting needs a new
   acceptance origin.
4. Who may move items: owner or admin in both stores (proposed), or staff
   in the source store with approval in the target?
5. Does a chain need its own plan and invoice (one subscription for all
   stores), or does each store keep its own 199 kr plan for now? Proposed:
   each store keeps its own plan until Stripe supports the grouping.

## Not in this proposal

Central warehouse, picking, RFID, cross-store consignor identity, and a
chain-level Zettle or Fortnox connection. Each store keeps its own
integrations.

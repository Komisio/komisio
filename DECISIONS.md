# Technical decisions

This log records public engineering constraints. Product contracts are documented
in [ARCHITECTURE.md](ARCHITECTURE.md) and the relevant integration guides; database
tests specify their executable boundaries.

Describe proposed behavior and tradeoffs in the issue or PR before changing code.
Do not infer legal or financial rules from a prompt or an implementation detail.
Use a focused regression test for a changed invariant.

Each entry is one dated line of at most 300 characters. Deployment records,
business planning and installation-specific procedures do not belong here.

<!-- technical-decisions -->

- 2026-11-19: For new staff-assessed central items, confirm a private payout preference once and queue one payout at each item's purchase or guaranteed credit. The request pins the destination. Bank execution and paid status remain separate. No historical backfill.
- 2026-11-19: New central app submissions delegate the method to Komisio. After physical receipt, staff inspect each item and confirm purchase (default) or guaranteed consignment at the submitted amount. Existing purchase and guarantee evidence remains authoritative. Historic terms stand.
- 2026-11-19: Swedish central payout requests default to Swish or allow a saved bank account. Each request freezes the confirmed mobile number or bank version. Legacy bank requests keep their replay and review rules. Recording a request does not execute a transfer.

- 2026-11-19: Financial writes pass through the engine and database commands; UI, MCP and integrations share the same tenant and permission boundaries.
- 2026-11-19: Financial and legal facts remain immutable. Corrections append evidence; additive migrations preserve already-applied database history.
- 2026-11-19: Runtime authorization is enforced by RLS, grants, identity and tenant checks. Documentation and model prompts confer no access.
- 2026-11-19: Money uses decimal database arithmetic rounded to currency minor units; client floats are not authoritative financial calculations.
- 2026-11-19: Product code, tests and public documentation build independently of private working material. Optional local contributor guidance is ignored by Git.
- 2026-11-19: Central sellers select consignment or direct purchase before submission. A direct purchase needs item-level inspection after physical receipt. The purchase, ownership and full balance credit are atomic and replay-safe, separate from bank payment. Legacy submissions retain consignment.
- 2026-11-20: Central staff may offer a lower price once for 48 hours. Seller acceptance fixes the amount for purchase, guarantee and payout and starts shipping with the saved sender details. A rejection without a price remains final.
- 2026-11-20: Notify consenting central sellers once per device when a direct purchase or day-45 acquisition credits their item. Use the sale sound. Approval, shipping, payout and subsequent resale do not repeat the purchase notice.

# Phase P1: accept and hold, as bounded slices

Status: lead-architect specification, 2026-09-12, after the owner answered
open questions 2 and 3 and convergence assumptions A1 to A4 (DECISIONS.md).
Each slice is one PR with its own decision lines, pgTAP first, an additive
migration where marked, engine command, thin surface and tests. Slices are
ordered by dependency; S1 unblocks everything else. Nothing here touches
sales, VAT treatment, payouts or settlements (phase P2).

Conventions that apply to every slice, inherited from the codebase: writes
are authenticated SQL functions with role, MFA, tenant lock, replay by request
id and access events; tables are append-only with immutability triggers; RLS
selects for members; every agent write is a pending operation with a risk
level; no edit to an applied migration; no reset of the shared database.

## S0. Per-kind dispatch for staged operations

Purpose: stop rewriting `valid_operation_payload`, `propose_operation` and
`decide_operation` in full for every new kind. Three migrations have already
re-declared all three bodies to add one kind each; S2, S4 and S5 would add
three more kinds.

- Split each kind into two private functions with a fixed signature:
  `komisio_private.op_preflight_<kind>(p_tenant uuid, p_payload jsonb)`
  (structural validation plus the same preconditions the engine enforces,
  raising the engine's error codes) and
  `komisio_private.op_execute_<kind>(p_tenant uuid, p_operation uuid,
p_payload jsonb) returns uuid` (calls the engine function).
- `propose_operation` and `decide_operation` keep their signatures and
  become short dispatchers: a `case op.kind` with one line per kind, no
  dynamic SQL. Risk level per kind lives in one small
  `komisio_private.operation_risk(p_kind)` function.
- Move the two existing kinds into this shape with behaviour unchanged;
  existing pgTAP files 0015, 0017 to 0019 must pass without edits, plus a
  new test asserting that an unknown kind is rejected in both functions.
- Migration: yes (create-or-replace of the three functions, new private
  functions). No table change.

## S1. Store policy

Purpose: one versioned policy record per tenant that the intake commands read,
replacing hard-coded behaviour and the single `required_before_receipt` flag.

- Table `store_policy_versions`: tenant, version, created_by, created_at and
  the policy body as validated jsonb with exactly these keys:
  `commissionBasis` (`inclusive` | `exclusive`), `commissionRatePercent`
  (numeric, two decimals), `agreementRequiredFor` (subset of
  `bag_receipt`, `review_publication`, `acceptance`; default the last two),
  `custodySources` (subset of `staff_receipt`, `locker`, `seller_dropoff`;
  default `staff_receipt`), `sellerReviewMode` (`delegated` | `per_item`;
  default `delegated`), `salePeriodDays`, `markdownSteps` (list of
  `{afterDays, percent}`), `endOfPeriodAction` (`charity` | `return`),
  `unsoldNotifyAfterDays` (nonnegative integer; owner addition 2026-09-13),
  `minPayoutThreshold` (numeric). Defaults for a tenant with no version come
  from constants that mirror `skills/consignment-sweden/SKILL.md`; the skill
  is the documentation of the defaults, the constants are the enforcement.
- `publish_store_policy(p_tenant, p_id, p_expected_current, p_policy)`:
  owner or admin, replay-safe, expected-previous check like agreements.
- `current_store_policy(p_tenant)` security-invoker read returning the
  effective policy with defaults filled in. Used by every later command.
- Replace `receive_bag_with_agreement` and `publish_reception_review` with
  versions that read `agreementRequiredFor` from the policy; the existing
  `required_before_receipt` column stays for old rows and is honoured as
  "also required" so nothing loosens for existing tenants.
- Surface: a settings page section (owner/admin) showing the effective policy
  and a form to publish a new version; readonly sees it. Agent tool
  `get store policy` under an existing read scope.
- Tests: pgTAP for validation, defaults, replay, expected-previous, role and
  MFA denial, and that the two intake commands change behaviour with the
  policy; unit tests for the zod schema; browser check of publish.
- Migration: yes.

## S2. Seller terms

Purpose: the per-seller commission flag and rate override the owner asked for,
without making `sellers` mutable.

- Table `seller_terms_versions`: tenant, seller, version, `commissionBasis`
  (nullable, overrides policy), `commissionRatePercent` (nullable override),
  `notes`, created_by, created_at. Append-only.
- `publish_seller_terms(...)` owner/admin/staff, replay-safe, expected-previous.
- `effective_seller_terms(p_tenant, p_seller)` read merging policy and the
  latest seller version; this is what acceptance freezes.
- Surface: a section on the seller view. Agent tools: read effective terms,
  propose seller terms (staged, risk `low`).
- Migration: yes.
- Status 2026-09-13: table, publish and effective read, engine command, seller
  page with form and history delivered. The staged kind `proposeSellerTerms`
  and the MCP read tool follow with S4's operations work.

## S3. Garment custody

Purpose: the custody fact the garment path lacks (A1).

- Table `garment_receipts`: tenant, reception session, reference (global
  sequence like bag receipts), note, custody source (from policy), created_by,
  received_at. One per session at most; immutable.
- `receive_garment(p_tenant, p_id, p_session, p_note, p_source)`: staff,
  session in tenant, source allowed by policy, replay-safe.
- Label: reuse the bag-label component with a garment variant (the item
  template proper comes with P2's label engine).
- Reception queue: new derived stage `awaiting_custody` when a review is
  published but no receipt exists; `nextStep` guidance updated.
- Surface: one button on the reception page; MCP read exposes custody in the
  session read; no agent write.
- Migration: yes.

## S4. Items and commercial acceptance

Purpose: the single command that turns an origin into an item with frozen
terms. This is the centre of P1.

- Table `items`: tenant, id, origin kind (`inspection_draft` |
  `reception_review` | `purchase`), origin references (draft id + revision, or
  review id + optional response id, or purchase receipt id), custody reference
  (bag receipt or garment receipt; null only for `purchase` via POS), seller
  (null for purchase), ownership (`consignment` | `store`), frozen terms jsonb
  (commission basis and rate, sale period days, markdown steps, end-of-period
  action, agreement version id, evidence kind: `staff_recorded` |
  `seller_response` | `none`), description snapshot by reference to the
  origin, accepted_by, accepted_at. Immutable.
- Table `item_events`: append-only stream (accepted, price set, listed, stage
  changed, AI provenance copied from the origin). Table `item_prices`:
  append-only price series with actor and reason; the first row is the
  accepted price.
- `accept_item(p_tenant, p_id, p_origin_kind, p_origin_ref, p_custody_ref,
p_price)`: staff; checks the origin is current (latest draft revision or
  latest review with current sources), custody present when required by the
  origin kind, agreement prerequisite per policy, seller review requirement
  per policy (`per_item` demands an approve response on that exact review;
  `delegated` demands none), freezes terms from `effective_seller_terms` and
  the policy at that moment, records the first price and the events. Replay
  by id; conflicting retry fails.
- Staged operation kind `acceptItem`, risk `medium` (different approver than
  the proposing identity, per the existing rule); MCP tool
  `komisio_propose_acceptance` under a new scope `items:propose`; approval
  executes `accept_item` as the approver.
- Surface: an "Accept" action on the inspection page and the reception page
  that shows the frozen terms before confirming; an items list (thin) with
  the price series and events. Readonly reads.
- Tests: pgTAP for every precondition and both policy modes, replay, RLS,
  MFA, immutability; race of two acceptances of one origin; stdio MCP case
  for propose plus approval by a second user; browser journeys for both
  origins.
- Migration: yes.
- Status 2026-09-13: tables, accept_item for all three origins, engine
  command, accept actions on the reception, inspection and purchases pages,
  items list and detail delivered with pgTAP for every precondition. Staged
  kind `acceptItem` (medium) and MCP tool `komisio_propose_acceptance` under
  `items:propose` delivered with migration `20260913220000`; the
  race script covers two acceptances of one origin and concurrent
  approvals of one proposal; the browser journeys remain.

## S5. Purchase registration

Purpose: the third origin for store-owned items.

- Table `purchase_receipts`: tenant, reference, supplier note (free text, no
  seller link), purchase price (numeric, öre), created_by, created_at.
  Immutable.
- `register_purchase(...)`: staff, replay-safe. `accept_item` accepts origin
  `purchase`, ownership `store`, no seller, no agreement, evidence `none`.
- POS-sourced purchases (Zettle) arrive in P2 through the same table with a
  provider reference.
- Surface: a small form on the intake page; agent tool to propose a purchase
  (staged, `low`).
- Migration: yes.

## S6. Delegated pricing as the default path

Purpose: make the built seller-review flow opt-in (A3).

- When `sellerReviewMode` is `delegated`, publishing a review does not offer
  a seller link and the queue goes straight from `needs_review` or
  `ready_to_share` to `awaiting_custody` or `ready_to_accept`; when
  `per_item`, today's link and response flow applies unchanged.
- Seller-facing wording: the seller app shows accepted items and prices as
  facts, not as something to approve, unless the tenant uses `per_item`.
- No migration: queue and UI derive from the policy; pgTAP for the stage
  derivation in both modes; browser journey for delegated publication.
- Status 2026-09-13: stage derivation in SQL (`reception_queue` replaced
  additively) with `awaiting_custody`, `ready_to_accept` and `accepted`;
  pgTAP for both modes; delegated notice on the reception page. The seller
  link remains optional in delegated mode; hiding it and the seller-app
  wording follow with the seller app work.

## S7. Provenance into items

Purpose: keep the AI provenance the origin recorded.

- At acceptance, copy the origin's per-fact confirmation record (PR51) and
  the model attempt reference into `item_events` as one `provenance` event.
- No migration beyond S4; tests assert the event exists and cites the origin.
- Status 2026-09-13: delivered as migration `20260913210000` (event kind
  `provenance`, private helper `komisio_private.item_provenance`, accept_item
  re-declared with one extra insert); pgTAP covers review provenance with a
  model attempt, a draft produced by an approved agent proposal, and that
  purchases carry none.

## S8. Staff mobile reception

Purpose: the earlier mobile registration flow for staff, on the existing
pages.

- Make the reception, inspection and acceptance pages usable at phone width
  with camera capture, and add a scan-to-open for bag and garment references.
- No migration; browser journeys at 390 px for reception with photo, garment
  custody and acceptance.

## S9. Assistance port per feature

Purpose: finish the unified port.

- Provider and model selection per feature (reception, later description
  regeneration) in server configuration; tenant enablement moves from the
  environment allowlist to the store policy (`assistanceEnabled`), still with
  the server-side kill switch.
- No migration beyond a policy key; unit tests for configuration resolution.
- Status 2026-09-13: `assistanceEnabled` policy key (migration `20260913230000`),
  settings checkbox, enablement resolved from the policy with the environment
  allowlist kept as a pilot fallback and the provider configuration as the
  kill switch. Provider and model selection per feature stays in server
  configuration; a second feature does not exist yet.

## Order and exit

S0 → S1 → S2 → S3 → S4 → S5 → S6 → S7, with S8 and S9 in parallel after S4. P1
is complete when one store can, locally and in staging with synthetic data:
publish a policy, register a seller with a commission override, receive a bag
and a wall garment, accept an item from each origin and from a purchase
under the delegated default, see its frozen terms and price series, and have
an agent propose an acceptance that a second person approves. Sales,
returns, VAT treatment and payouts remain out of scope until P2.

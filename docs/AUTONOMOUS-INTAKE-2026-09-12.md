# Autonomous reception delivery

Owner authorization: build the single-garment vision-to-seller-decision flow
independently, using reasonable assumptions, commits, PRs and staging. Work ends
2026-09-12 06:10 Europe/Stockholm (04:10 UTC). This replaces the earlier GUI-first
continuation sequence. Read private/staging-handoff.md before resuming.

## Outcome

A seller identifies a reception session, supplies a garment with images or
observations, receives a sourced description and proposed price, and approves or
declines the exact displayed review on mobile. Store commercial acceptance is
separate. Bag-first inspection remains another input to preparation; do not
create a fake bag receipt to represent a garment on the reception wall.

## Delivery order

1. Shared typed observation/proposal/review/decision contracts and replaceable
   assistance adapter, with a complete headless workflow test. Document the
   Accounted comparison. Model output cannot choose tenant, seller or authority.
2. Durable reception sessions and immutable proposal/review/decision records,
   with database tests before migrations, membership/MFA checks, exact revision
   binding, expiry and idempotency. Use minimal persistence for this workflow,
   not the ABP model. Seller access is a separate capability, never staff
   membership or a claimed email string. Review identity/link architecture first.
3. Private image capture/storage and a real optional model adapter. Authorize
   object ownership, bound types/sizes and inference. Do not reuse unrelated
   credentials or invent live results when configuration is absent. Keep manual
   observation fallback. User uploads never become trusted instructions.
4. One mobile review: garment, evidence, uncertainty, proposed price, exact terms,
   approve/decline. One operator workspace only as needed for this journey.
5. Authenticated agent tools through the same operations, tested scopes and
   staged writes. An ordinary JSON API is not an MCP implementation.
6. Relevant local tests, exact-head CI, staging and synthetic walkthrough. Publish
   coherent tested slices through signed-off commits and PRs.

## Assumptions and boundaries

- One garment per session, no facial recognition.
- Price is a proposed selling price in SEK, not payout or guaranteed sale.
  Require source references/rationale; unknown price remains absent. Do not guess
  market data, VAT, commission or payment rules.
- Automatic commercial acceptance defaults off. Seller approval does not publish
  the garment to POS.
- Tenant policy is supported validated configuration, not arbitrary prompts.
- No real email, payments, DNS changes, service purchases or unrelated secrets.
- Preserve owner changes and existing staging records. Use synthetic data only.
- Missing external credentials limit live verification, not independent work.
  Clearly distinguish implemented, simulated and unconfigured capabilities.
- Pause the heartbeat at the deadline or completion, securing unfinished work
  and recording a truthful handover. Notify only material progress or problems.

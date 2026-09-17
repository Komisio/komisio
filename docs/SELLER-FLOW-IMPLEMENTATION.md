# Seller journeys and implementation sequence

Owner requirements and source review, 11 September 2026. This is a fresh design;
the earlier .NET and mobile prototypes are behavioral references only.

## Findings and changes

| Earlier behavior inspected                                                                          | Keep                                                       | Simplify or investigate                                                                                       |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Active tenant agreement, translations and acceptance lookup                                         | Versioned terms and evidence of who accepted what          | Bind acceptance to the authenticated seller; define explicit language fallback and version changes            |
| Staff workspace and batch item intake                                                               | Resumable inspection and safe label reprints               | Receive bags first; no compulsory item price or catalogue match at handover                                   |
| Section collision and concurrent seller booking checks                                              | Prevent double booking and support tenant limits           | Enforce collisions atomically in the database, not only a preflight check                                     |
| Date-dependent daily, weekly and monthly pricing with breakdowns                                    | Explain the quoted fee to the seller                       | Start with one clear fee basis; snapshot the quote before adding overlapping rules and proration              |
| Booking service distinguishes confirmed bookings, pending/settled fees and fees reserved for payout | Keep booking occupancy separate from payment settlement    | Do not mark payment complete on booking creation or inherit deduction rules without an agreed financial model |
| Booking cancellation contains fixed fee percentages and date thresholds                             | Make cancellation consequences visible before confirmation | Treat cancellation policy as tenant-specific product work; do not copy the old constants                      |
| Agreement administration exposes update/delete and translation editing                              | Let staff prepare and maintain terms                       | Separate editable drafts from immutable published versions and preserve acceptance evidence                   |

Inspected source: the earlier backoffice's TenantUserAgreementAppService,
StoreSectionBookingValidationService and StoreSectionBookingPricingCalculator,
with a targeted method/branch scan of StoreSectionBookingAppService and
TenantUserAgreementAdminAppService,
plus the intake sources summarized in INTAKE-WORKFLOW-PROPOSAL.md. These were
read, not executed. Authorization in other layers and end-to-end booking/payment
behavior have not been verified. No implementation or assets were copied.

## Delivery slices

1. **Staff bag receiving (this change):** find/register a seller; receive one bag;
   see received bags awaiting inspection; open and reprint an individual label.
   One name and a contact channel are required. A seller is a contact, not a
   staff member or automatically verified portal identity. Custody receipt is
   explicitly not approval of contents or confirmation of agreement acceptance.
2. **Agreement and seller access:** publish immutable agreement versions;
   capture authenticated acceptance or a clearly distinguished staff-recorded
   external evidence reference; QR registration and verified linking of contacts.
   Decide required agreement checkpoints and language fallback. Never infer
   acceptance from the absence of a translation or from possession of a bag label.
3. **Inspection:** [shared descriptive drafts](SAVED-INSPECTION.md) can now be
   saved and resumed per bag. Later: apply tenant price approval
   and rejected-item policy, explicitly finish inspection. Add correction events
   for mistaken receipts before external pilot use. Manual entry works without AI.
4. **Optional receiving channels:** self-drop-off and pickup, with separate
   expected/collected/received facts and explicit custody responsibility.
5. **Space booking:** availability, sales mode, quote, terms and confirmation.
   Support seller checkout and shared store checkout within the product; propose
   allowing a tenant to enable both and selecting a mode per booking. No fee or
   revenue sharing assumptions are inherited from the earlier system.
6. **POS and payouts:** ingest deduplicated sales/returns from external POS,
   establish ledger rules, then seller payout requests. Research identity
   verification and Stripe feasibility, onboarding, funding and failure
   reconciliation separately.

## Configuration boundary

Tenants choose supported operating policies, not arbitrary executable rules.
No setting can disable tenant isolation, actor attribution, replay protection
or financial invariants. Preserve the applicable terms/quote when an agreement
or booking is confirmed. A later settings edit must not silently rewrite it.

## First-slice operating limits

This is a staff pilot surface, not a complete intake service. No email receipt,
seller portal, agreement signing, booking, inspection completion or payout is
available yet. Do not use it to assert legal acceptance or sale readiness.
There is no draft recovery across a reload; input survives a failed request in
the open page. A successful save always appears in the persisted list. After an
ambiguous error, retry unchanged input before creating another operation.

Enable only after applying migrations: `npm run db:migrate` locally, or the
reviewed additive migration through the hosted deployment procedure. Set
`KOMISIO_INTAKE_ENABLED=true` on the server and rebuild/redeploy. Default is off;
UI routes and API stay unavailable until enabled. Disabling hides the surface
without deleting receipts. This release does not automatically migrate staging.

**Staging update, 11 September:** the owner authorized direct activation of tested
features. The bag-receiving migration is applied and the flag is enabled on the
staging deployment. Future migrations still require explicit target verification;
activation no longer requires a separate owner decision.

## Verification of the first delivery

Locally verified with synthetic data: 74 pgTAP assertions, 30 unit tests, eight
browser journeys, lint, formatting, TypeScript and production build. The real
two-connection test also races identical receiving requests: one bag and one
audit event persist. The browser test loses a successful server response and
retries the frozen request, then checks persistence and label privacy. Mobile
layout and print media were inspected; physical printer hardware was not tested.

Self-review covered authenticated RPC grants, tenant/seller foreign keys, RLS,
MFA, membership removal, duplicate/replayed writes, request-size limits, origin
checks and contact visibility. There was no independent reviewer. Hosted
activation and an authenticated hosted receiving walkthrough are recorded in
HOSTED-STAGING.md separately from this local evidence; CI is checked before merge.

## Seller agreement evidence implementation

The first staff slice is implemented as described in
[Seller agreement evidence](SELLER-AGREEMENTS.md). It publishes immutable versions,
records external evidence and checks receipt prerequisites. Seller-authenticated
approval and verified identity remain future work.

Proposed bounded slice under the owner's autonomous-development authorization:

- Owners/admins publish a new immutable version of the store's own plain-text
  agreement. Komisio does not generate or claim to validate legal terms.
- Staff sees the exact current version while registering or receiving from a
  seller. Missing translations must be visible, not treated as acceptance.
- Initially distinguish staff-recorded evidence of an external acceptance from
  the later seller-authenticated acceptance. Never present a staff
  checkbox as the seller's digital signature.
- Let the tenant choose whether recorded acceptance is required before receipt.
  Existing tenants start without a new blocking requirement. Changing that policy
  must not rewrite previous receipts or previously accepted agreement versions.
- When receipt requires evidence, the database checks the seller, tenant and
  current agreement together; retrying an earlier receipt returns its original
  result even after the tenant publishes a new agreement version.
- Record the exact agreement/evidence reference on a new receipt. Use the shared
  engine and authenticated RPCs; test cross-tenant references, role boundaries,
  version replacement and concurrent publication/receiving before activation.

This is the contract for the implemented staff-evidence slice, not a digital
signature feature. Identity verification, legal interpretation and payout
authorization remain
separate from recording the store's agreement evidence.

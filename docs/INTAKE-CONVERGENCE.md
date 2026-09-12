# ADR: where the two intake paths meet

Status: accepted with owner answers on 2026-09-12 (see the assumptions table
at the end). Specification only: no migration, engine command or UI is
introduced by this document.

## Context

Komisio has two ways to take in goods, and they share only `sellers` and
`seller_agreement_versions`:

| | Bag-first | Single-garment reception |
| --- | --- | --- |
| Custody fact | `bag_receipts` (printed label, staff-attested) | none; a session proves nothing physical |
| Description | `inspection_draft_revisions`: description, category, condition | `reception_reviews`: seven descriptive fields, sourced price, pinned photos, pinned terms |
| Price | none | sourced proposed selling price, seller-approved or declined |
| Terms | agreement version and optional evidence pinned on the receipt | agreement version pinned on the review; seller reads it on mobile |
| Agreement prerequisite | none unless the tenant requires evidence before receipt | always: a review cannot be published without a current agreement version |
| Seller consent | staff-recorded external evidence, optional | immutable approve/decline per review, seller-authenticated |

Both stop before the same missing step: the store accepting responsibility for
one item under known terms (docs/STORE-FOLLOW-UP.md, step 4). If that step is
designed once per path, "item" will mean two things before commission, VAT and
settlement exist, and every later slice (labels, POS, returns, payout) doubles.

## Decision proposed

1. **One item, two origins.** A future `items` record is created only by one
   commercial-acceptance command. That command accepts either origin:
   - an inspection draft revision (bag path), or
   - a reception review plus its seller response (garment path).
   The item pins the origin's exact revision or version and never copies its
   text; the origin stays the immutable evidence. Nothing before acceptance is
   an item, sellable or a balance.
2. **Custody is a separate fact from description and from consent.** A bag
   receipt is custody for the bag path. The garment path gets its own custody
   event, `garment_receipts` or equivalent, recorded by staff when the garment is
   physically at the store, with a printable reference like a bag label. A
   session, a photo and a seller approval do not create custody, and acceptance
   requires a custody fact from either kind. *(Assumption A1: staff attest
   custody for wall garments the same way they attest a bag today.)*
3. **One agreement prerequisite for both paths.** Whether a current agreement
   version must exist, and whether recorded evidence or a seller-authenticated
   approval is required, is decided by tenant policy and evaluated identically by
   `receive_bag_with_agreement`, `publish_reception_review` and the future
   acceptance command. Today the review path hard-requires a published version
   and the bag path does not; the ADR makes that a policy rather than an
   accident. *(Assumption A2: the pilot policy is "a published version is
   required for review publication and for acceptance, optional for bag
   receipt", which matches current behaviour and changes nothing until the
   policy table exists.)*
4. **The seller's approval of a review counts as agreement evidence for that
   item only.** It is the seller's answer to exact text, price and terms, not a
   general acceptance of the store's agreement. Bag-path evidence remains a
   staff-recorded reference to an external approval. Both are recorded on the
   item at acceptance as "evidence of terms", with their kind. *(Assumption A3.)*
5. **Acceptance must preserve the terms actually evidenced.** The exact frozen
   term set and timing remain open question 3. A seller response already pins a
   review and agreement version; later tenant policy cannot silently replace
   those terms at acceptance. If the store requires changed terms, the future
   command must require appropriate new evidence rather than treating the old
   approval as consent to the change. Questions 2 and 3 must be answered before
   implementation. Descriptive fields, price and photos retain their origin
   references; this proposal does not select a financial schema.

## What each path keeps and drops

- Bag path keeps: receipt, label, resumable drafts with history, archive and
  reopen. It gains nothing new until acceptance exists. Its drafts stay
  descriptive; a price on a bag item enters through the same reviewed-price
  contract the garment path already has, not through a new draft field.
- Garment path keeps: sources, reviews, seller link and response, queue and
  staged proposals. It gains a custody event before acceptance can happen.
- Neither path gets a "done" or "accepted" flag before the acceptance command.

## Consequences

- The reception review's descriptive contract becomes the description contract
  for items from both origins. The inspection draft's three fields are a subset
  of it; no field is lost. *(Assumption A4: category and condition semantics are
  the same in both.)*
- The queue (docs/RECEPTION-QUEUE.md) and the bag queue stay separate work
  lists; a later "ready for acceptance" stage in each points at the same
  command.
- Staged operations (docs/STAGED-OPERATIONS.md) would gain an acceptance kind when
  acceptance exists: an agent may propose acceptance, at a risk level above
  `low`, which by the existing rule requires a different approver than the
  authenticated identity that proposed it, not merely another session.
- Retention and correction rules for custody events follow those already
  decided for bag receipts: no edit, no delete, corrections as new rows.

## Not decided here

Commission basis and VAT treatment (questions 2, 5), frozen term set
(question 3), price reduction (4), what the seller sees of an accepted item,
and any POS or label format. This ADR proposes the shape of the convergence
so those answers land in one place.

## Assumptions, answered by the owner 2026-09-12

| # | Assumption | Answer | Consequence |
| --- | --- | --- | --- |
| A1 | Staff attest custody of wall garments with a receipt-like event | Yes by default, configurable per tenant | Custody event exists for both paths; a tenant policy may allow another custody source (locker, seller drop-off) later |
| A2 | Agreement required for review publication and acceptance, optional at bag receipt | Yes by default, configurable per tenant | The agreement prerequisite is one tenant policy evaluated identically by all three commands |
| A3 | Seller approval of a review is item-level evidence | Overturned. By default the store sets the price and the seller has delegated that decision to the store (and its AI and statistics); no per-item approval is required. Per-item seller review stays available as an opt-in tenant policy | Acceptance does not require a seller response unless the tenant policy demands it; the existing review and response flow becomes the opt-in path; the general agreement (with evidence or authenticated acceptance) is the seller's consent to delegated pricing |
| A4 | Category and condition mean the same in drafts and reviews | Owner: category and condition are two separate things | Both paths carry category and condition as two distinct facts; neither is derived from the other and they are never merged; acceptance takes both from the origin without mapping |

Decision 4 above ("the seller's approval counts as agreement evidence for that
item only") therefore applies only when the tenant has enabled per-item seller
review. Decision 5 stands: whatever was evidenced at acceptance is frozen.

## Store-owned items

Owner decision 2026-09-12: a store-owned item enters through a separate
purchase registration without a seller, or through the POS integration
(Zettle first, then Shopify POS) when the POS already knows the item. It
never enters through the consignment paths. The acceptance command therefore
has a third origin, `purchase`, with no seller, no agreement and no seller
consent, and ownership `store` frozen at acceptance.

# Intake: keep the useful ideas, simplify the journey

Proposal for owner review, 11 September 2026. **Not an implemented feature or an
approved financial model.** The platform acceptance gate remains open.

## Owner clarification, 11 September 2026

The following requirements supersede the item-at-counter proposal below. They
describe product scope, not implemented behavior or an approved payment model.

- Receive a bag first; staff inspects and registers its contents later. An item
  description or price is therefore not required to acknowledge bag receipt.
- Staff can register sellers manually. Sellers can also self-register through
  a QR code at the counter. Print a bag label linking the bag to the seller.
- Authenticated self-drop-off and pickup from registered sellers are optional
  tenant capabilities. Their detailed handover and verification steps remain open.
- Price approval, treatment of rejected goods, and agreement/receipt requirements
  are tenant-configurable. Email receipt is a likely normal option, not a mandated
  default. Review the old agreement flows before specifying approval evidence.
- Sellers should follow their submissions and sales in the web/app and request
  payouts. BankID is a desired identity integration. Stripe is to be investigated
  for seller payouts, not assumed to provide a suitable money flow already.
- Komisio is initially not a POS. Sales should integrate with external systems
  such as Zettle POS or Shopify POS; no connector capability is verified here.
- Optional space booking supports premises or other areas such as flea markets,
  with a seller fee calculated under tenant-specific rules.
- Both seller-operated sales at a booked space and store-operated sales through
  a shared checkout must be supported. Do not assume that seller-operated sales
  pass through the store or create a store liability to the seller.

Recommended next slice: find/register a seller, record the applicable agreement
step, receive a bag, print/reprint its label, and show the inspection queue.
Multiple bags per handover are a proposal still to validate.

Configuration design proposal: a tenant enables supported capabilities and
policies; each booking identifies its sales mode. Avoid a generic workflow
builder initially. Permissions, tenant isolation and auditable financial writes
remain mandatory. How policy changes affect existing agreements and bookings
must be decided explicitly; do not silently apply new terms to old handovers.

Before implementation, inventory the earlier agreement and booking journeys as
behavioral evidence, challenge unnecessary steps, and define the minimum seller
identity, agreement evidence, bag custody, fee rules and payment responsibilities.
No old code or schema is to be copied.

## What the earlier prototypes teach us

This review covers the earlier mobile app's capture/review/submit journey and
the backoffice intake workspace, batch-entry flow and smart-intake notes. These
are observations from source and documentation, not evidence of use by real stores.
No source code or data model has been ported into the new project.

| Observed pattern | Useful need | Proposed improvement |
| --- | --- | --- |
| Capture photos, request AI suggestions, review, then submit | Help describe an unfamiliar item | Make photos and AI optional enrichment in one item editor |
| Separate intake workspace with completion and seller-verification actions | Distinguish preparation from an agreed handover | Identify exactly what each confirmation proves before adding workflow states |
| Batch entry with per-row results and label printing after creation | Process a bag of items quickly and handle partial failure | Keep a visible batch, stable row identities and explicit saved/unsaved results |
| Browser-local batch drafts | Resume interrupted counter work | Decide authenticated draft persistence and ownership; do not rely on one browser for important handovers |
| Mobile in-memory edits and a separate submit step | Let the seller review suggestions | Save progress deliberately and show which changes actually reached the server |
| Suggested price and mandatory price in the smart review | Support pricing decisions | Question whether price must be known at physical receipt or only before sale |
| Several item, flow and transaction concepts appear in intake | Support downstream operations | Show only the states the person at the counter needs; add later lifecycle rules when required |

One implementation detail deserves a workflow test: the mobile review holds more
editable values than the inspected final submit path explicitly sends. That is
not proof that all other paths lose data, but it is a reason to require a
round-trip test for every editable field in the new flow.

## Two journeys, one shared intake capability

**Staff receiving goods** is the first delivery. The staff member is present
with the goods and can confirm physical receipt.

**A consignor proposing goods remotely** is a later delivery. Sending photos is
an offer to the store, not proof of receipt. A seller's submission must not
silently make an item available for sale or establish payout eligibility.

Both can eventually use the same underlying operations, with different
permissions and an explicit receiving step. Do not expose staff authority to a
seller merely because both interfaces collect similar information.

## Earlier first staff journey (superseded by bag-first clarification)

1. **Who is handing things in?** Find an existing consignor or create a minimal
   contact. Show the active store throughout. Warn about possible matches and
   let staff choose; do not automatically merge people by phone or email.
2. **What arrived?** Add one or several items in a single workspace. A short
   distinguishing description is the starting point. A photo, category and
   proposed price can enrich it when useful. Keep the consignor and batch context
   visible instead of asking for them on every item.
3. **Review and receive.** Show exactly which items will be recorded, unresolved
   information and the meaning of confirmation. After a successful operation,
   show the recorded item references and offer labels or another item.

The final confirmation wording and evidence depend on the agreement/receipt
decisions below. Do not label a prototype action as legally binding acceptance
until those decisions have been made.

### Example to validate with a shop

A returning consignor brings a jacket, a vase and two books. Staff finds the
person once, adds the items, corrects the jacket description and receives the
batch. Pricing the vase may require someone else. The question is whether the
shop can record physical receipt now while keeping the vase unavailable for sale.
This scenario should determine the workflow, rather than the existing table fields.

## What to simplify first

- Use one receiving workspace instead of separate screens for each small edit.
- Keep manual entry fully usable when AI is unavailable, slow or out of quota.
- Avoid requiring a product catalogue match or creating a catalogue product
  merely to describe a unique second-hand item.
- Offer AI suggestions for individual fields, with an explicit way to accept or
  reject them. Human edits must not be overwritten by a later AI response.
- Separate receiving, preparing for sale and selling. A price suggestion should
  not itself approve a sale price, commission or tax treatment.
- Treat printing as a repeatable follow-up. A printer failure must not receive
  the goods twice; reprinting must reuse the same item references.
- Show recoverable errors next to the affected item and retain the user's work.
  Do not show a single success banner when some rows failed.

## Reliability scenarios before implementation is called complete

| Situation | Required user-visible outcome to agree and test |
| --- | --- |
| The user double-clicks Receive | The same intended handover is not duplicated |
| The network fails after a successful save | Retrying resolves the original result rather than creating another item |
| One item in a batch is invalid | The UI states whether nothing saved or lists exactly what saved; no ambiguous partial success |
| The browser reloads during drafting | The agreed draft policy makes recovery or loss explicit |
| Another tab changes the active store | The operation cannot silently move to a different store |
| Another staff member edits the same draft | Conflicting edits are surfaced rather than silently overwritten |
| The same photograph is uploaded again | A possible duplicate is suggested, not automatically deleted or merged |
| A label cannot print | Saved items remain visible and printing can be retried safely |
| AI fails or times out | Manual receiving still works and user-entered data remains |
| A seller submits photos remotely | Nothing is marked physically received without authorized staff action |

## Original review questions (see clarification above for partial answers)

1. **Receipt versus acceptance:** can the shop hold unpriced or unapproved goods,
   and what does it give the consignor as evidence at that point?
2. **Minimum identity:** what contact information is necessary at the counter?
   When should possible duplicate consignors be reviewed?
3. **Price timing:** must every item have a price at receipt? The existing
   [first-slice draft](first-slice.md) assumes an initial price; this proposal
   intentionally reopens that assumption for review, without changing the rule.
4. **Batch outcome:** should final receipt be atomic, or can valid items save
   separately? Either choice needs an unambiguous retry and correction story.
5. **Draft ownership and retention:** can another staff member resume a draft,
   how long should it remain, and how are abandoned drafts handled?
6. **Agreement evidence:** which terms must be settled or recorded before the
   receiving confirmation? Financial assumptions remain in
   [open questions](open-questions.md), not inferred from the old implementation.

## Delivery order

1. Finish platform acceptance and review the scenario above with the owner.
2. Confirm the minimum information and receiving meaning; record decisions.
3. Build a small manual consignor/receiving journey through the domain engine,
   with only the persistence required by those decisions.
4. Validate batch recovery and labels against the chosen contract.
5. Add optional photo/AI assistance and later the consignor submission surface.

The existing roadmap describes an eventual shared engine and scoped agent
adapter. This proposal refines user journeys; it does not approve new tables,
machine credentials, payment behavior or accounting rules.

# Store follow-up after a seller response

Status: P3 specification. No commercial acceptance or new persistence implemented.
The queue is the work organizer; it is not an inventory or custody ledger.

The shared queue engine now returns a `nextStep` code and `guidanceOnly: true`
for every row. The staff UI translates that code; `komisio_list_receptions`
returns the same guidance. This is read-only advice, not an authorization,
pending command or persisted transition. An approved proposal explicitly points
staff to physical receipt and actual seller terms; sale activation is not yet
supported. Link guidance does not send mail or prove that a seller read a link.

## State boundaries

1. Reception session: store/seller context. No proof of physical custody.
2. Bag receipt: existing separate custody workflow; do not manufacture a bag for
   a wall-hung garment. A wall intake custody event needs its own later design.
3. Seller response: an immutable answer to exact description/photos/price/terms.
4. Store commercial acceptance: a future command accepting responsibility under
   resolved, item-bound terms. It must not be inferred from step3.
5. Article preparation: a future traceable item/label tied to that acceptance.
6. POS publication: a separate integration action and acknowledgement, not a local
   status that pretends an external channel accepted the item.

## Useful follow-up today

- Preparing: finish evidence and preview.
- Needs review: inspect changed sources, publish a new version and obtain a new
  response. Never copy the previous approval.
- Ready to share or revoked link: explicitly issue a new link, then share through
  the existing authorized/manual process. Do not send unsolicited mail.
- Awaiting seller: retain the work item; no automatic acceptance or contact.
- Expired unanswered review: publish a new review if still appropriate.
- Declined: inspect the exact declined review and discuss corrections outside
  the system if needed. A new proposal is a new version.
- Approved: staff checks physical custody, garment identity and the actual terms
  before any later acceptance. The present software does not execute acceptance.

Do not add a generic "done" or "accepted" button merely to clear the queue.
That would hide a real business decision. P4 persistence is deferred until an
operation's evidence and meaning are sufficiently defined; continue P6 shared
AI reads and P5 non-executing integration contract work meanwhile.

## Future acceptance command requirements

Require verified staff authority, tenant/session, exact source and review IDs,
exact seller response, actor-bound request ID and expected previous store decision.
Before recording anything, resolve which commercial terms are frozen per item
(commission, sale duration, markdown and end-of-period treatment). See
open-questions.md, consignment terms. Neither an AI skill nor test agreement text
supplies these rules. Expiry and withdrawal after a recorded seller response need
an explicit commercial decision; the queue's display logic cannot decide that.

Retries return the original successful result, conflicting/stale requests fail,
and corrections append a new auditable decision. No financial schema is designed
until those requirements can be tested. Background agent writes additionally need
identified actor/scope, durable staging and approval, which do not yet exist.

## Article/label and integration boundary

A future preview should reference the accepted immutable item and include a
stable internal reference, display description and agreed selling price. It must
report preview-only until the real acceptance command exists. Do not generate a
scannable sale label that falsely implies sale readiness. Bag labels keep their
existing physical-receipt meaning. POS-specific SKU/barcode, VAT classification,
location and channel mapping require a validated adapter contract. Publishing
needs idempotency and provider reconciliation; a timeout is an unknown outcome,
not success or permission to duplicate the item. No live POS writes are in scope.

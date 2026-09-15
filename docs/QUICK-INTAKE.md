# Quick reception

Owner decision 2026-09-15: the default way to take in a garment is one
screen, not a sequence of pages. The store's policy carries an intake
profile; the quick profile is the default for new stores and for stores
that have not chosen.

## Profiles (policy key `intakeProfile`)

| Profile    | What the staff does                                                                                     | What the seller does                                       |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `quick`    | Seller, photo, facts (assistant fills them when configured), price, "Ready for the shelf"               | Nothing per garment; the signed agreement covers the terms |
| `standard` | As quick; the item is held until the seller approves the price (planned: the review link is sent after) | Approves the price through the personal link               |
| `full`     | The step-by-step reception with source revisions, review versions, personal link, custody, acceptance   | Approves each review in the app                            |

Absent means `quick`. `standard` is accepted by the policy today and
behaves as `quick` until the follow-up that holds the item for approval;
`full` refuses the quick screen (`INTAKE_PROFILE_FULL`).

## What one click does (migration `20260916360000`, `quick_receive`)

One database transaction chains the existing engine steps for the session:

1. `save_reception_sources`: a new source revision with the staff's
   price evidence appended to whatever was saved (the photo, when taken).
2. `publish_reception_review`: the facts as observed metadata citing the
   photo (or the price evidence when there is none), the price in major
   units, the store's current agreement, valid one day.
3. `receive_garment`: custody by staff receipt.
4. `accept_item`: commercial acceptance at the price, under the seller's
   effective terms.

Every step keeps its own rules: the agreement rule of the policy
(`AGREEMENT_REQUIRED` when the seller has not signed the current version;
the screen links to the seller page to record it), `SELLER_APPROVAL_REQUIRED`
when the policy says the seller approves each price, one item per session,
the store's currency. All row ids derive from the request id, so a retried
request returns the same item and writes nothing new. Nothing is bypassed;
the reception history, versions and audit rows are the same as in the full
flow, which is why the quick screen can be turned off per store.

The label: when a printer is chosen (remembered per browser), the item
label is queued through the ordinary print route right after acceptance.
The assistant: with a photo and a configured provider the facts and the
price are proposed the same way as in the full reception (same quota, same
audit); without a provider the screen says so and the staff fills them in.

## Surface

`/intake/quick` (owner, admin, staff), linked from the top of the receiving
page. Seller search, camera input, facts, price, printer, result card with
the reference and "Next garment" that keeps the seller and the printer.

## Verification

`supabase/tests/0106_quick_intake.test.sql` (profile validation, agreement
rule, seller binding, fact whitelist, revision check, the item and its
provenance, replay, photo citation, full profile refusal, per-item approval
still binding, readonly refused) and `tests/e2e/quick-intake.spec.ts` (a
garment without a photo to an accepted item and the next-garment reset).

## Not in this slice

The navigation rework (five work areas), the `standard` hold-for-approval
behaviour, and label sizes per label kind (next slices).

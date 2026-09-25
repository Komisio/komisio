# Self drop-off

A seller announces a handover (a bag or a box) from the seller portal and
gets a reference `H-n`. The store records custody by receiving it: staff at
the counter today, a locker integration later. Receiving creates the
ordinary bag receipt under the same agreement rules, so inspection, items,
sales and everything downstream are unchanged. The owner approved the new
core table on 2026-09-13.

## Shape

| Record             | Meaning                                                                                                   | Mutability                          |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `seller_handovers` | One announcement: seller, kind, estimated items, note, reference; status open, received or cancelled      | Announcement immutable; status engine-only |
| `handover_events`  | Created, received (with the note and custody source) or cancelled, with the actor                          | Append-only                         |

The received bag's id derives from the handover id
(`komisio_private.derived_id('handover:received')`, md5 bytes in RFC shape),
so a replayed receipt finds its bag and the seller's list can show `K-n`.

## Rules enforced in SQL

- Enabled per store: the policy's `custodySources` must contain
  `seller_dropoff`, otherwise announcing fails with `HANDOVER_NOT_ENABLED`
  and the portal shows the counter instead.
- `create_my_handover`, `cancel_my_handover`, `my_handovers`: under the
  seller's own identity (the verified e-mail matches the seller row, as in
  the seller portal); a seller cannot act for another seller; no membership
  is granted. Cancelling is possible while open only.
- `receive_handover(tenant, id, handover, source, note)`: staff, admin or
  owner; source `staff_receipt` always, `locker` only when the policy lists
  it (`CUSTODY_SOURCE_NOT_ALLOWED`); the handover must be open
  (`HANDOVER_DECIDED`). It calls `receive_bag_with_agreement` with the
  current agreement version, so `AGREEMENT_REQUIRED` applies exactly as at
  the counter; the note becomes the bag note (or `H-n` when empty). Replay by
  event id.
- `handover_queue(tenant)`: members, newest 100, open first, with the
  seller's name.
- Both tables have RLS for members; the isolation sweep covers them.

## Surfaces

- Seller portal: "Announce a drop-off" with kind, estimated count and note; the
  list shows the reference large enough to show at the counter, the status,
  and the bag number once received; open ones can be cancelled.
- Staff: `/intake/handovers` lists announcements with a receive form
  (note plus one confirmation); scan-to-open accepts `H-n` and focuses the
  exact record, even outside the recent queue. Linked from the intake page.
- A locker integration calls `receive_handover` with source `locker` after
  the seller's reference opened a compartment; the integration and hardware
  remain later slices.
- The seller can show an on-demand QR code for an open announcement. It contains
  only a same-application `/scan?ref=H-n` link. Staff login and MFA return to the
  reference, then active-store lookup and explicit custody confirmation still
  apply. The human-readable reference remains available if the camera or code
  cannot be used. Automated tests decode the generated code independently;
  real phone-camera scanning remains unverified.

## What this does not do

No custody for garments (that stays the reception flow), no photos, no
seller-side item registration, no notification on receipt (the bag receipt
notifications are the existing ones), no locker hardware.

## Verification

`supabase/tests/0058_seller_handovers.test.sql`: policy gate, seller
identity boundary, replay and conflict, cancel, staff queue, agreement rule
on receipt, locker refusal without policy, receipt with derived bag id and
evidence, double receipt refused, seller view after receipt, immutability.
Unit tests cover the boundary shapes. No browser journey yet.

# Seller economy portal (Astra task 1)

Entry: `/seller`, outside the staff dashboard. Use `/register?next=/seller`
or `/login?next=/seller`; the garment review page also links here. There is
no new welcome email, payment rail or automatic account creation.

A verified Supabase session including required MFA is matched to a unique,
normalized seller email within each store. This follows the existing verified
email identity mechanism; a review token is not financial authorization.
Duplicate addresses in one store fail closed and need staff investigation.
Phone-only sellers need an email/account before portal access. This is not
BankID identity verification. No tenant membership is created for a seller.

Narrow SQL projections expose own balance/reservation, recent ledger,
payouts, statements and message content. Staff-only table policies stay in
place. Private adjustment reasons, staff user ids and provider identifiers
are omitted. The shared SQL calculation supplies both balances. Recent
lists are capped at 100 with an explicit notice; statement detail shows all
its frozen lines. Older-list pagination is a follow-up, not a complete
archive browser. Integer amounts must be safely representable in the client.

Seller payout requests share staff threshold, balance and replay rules;
request_source records seller versus staff. Requests do not reserve money:
approval does, per the existing rule. Several pending requests can exist;
all approvals re-check available balance under the tenant lock. A seller
has no approval/payment authority. A person who separately holds a staff
role retains that independent staff authority outside this portal.

Notification preferences are append-only. Automatic dispatch checks them
before transport, records seller_email.skipped with why seller_opt_out in
the store audit log, and fails closed if the check fails. Manual staff
messages remain separate. Opt-out cannot recall an already in-flight email.
No live email is sent in automated tests.

Validation: pgTAP covers own/foreign identity, MFA, duplicate email, direct
raw table denial, balance parity, threshold, reservation, request replay,
approval/payment denial, statement ownership and logged opt-out. A local
Playwright journey registers/verifies a synthetic seller with no membership,
reads balance, requests payout, saves preference and opens a statement.
A two-connection race checks simultaneous request retries. See the PR for
exact-head CI and staging release evidence; do not infer deployment here.

Coordination: PR86 c24b6cf is the task baseline. Migration versions begin at
20260915000000 after checking both worktrees and the shared local history.
Fable's unmerged migration files were not imported. The shared local DB was
ahead of main, so the two reviewed new migrations and the missing, already-published usage
migration 20260914100000 were applied and
recorded transactionally; no earlier migration entry was changed. Disposable
SQL tests also verify the branch from its own migration files.

Applying the older missing usage migration locally replaced the newer policy
validator. Additive migration 20260915002000 reconciles it with the published
notification-aware definition; existing versions/history remain untouched.

## My items (2026-09-15)

`my_items(tenant, seller)` (migration `20260916310000`, pgTAP 0101) projects
the seller's own accepted items under the same identity check: title and
category from the origin, current and accepted price, the lifecycle stage
shown to the seller as one of five plain states, the period end and the
store's end action, and the sale date and price when sold. No photos,
condition or staff notes. The portal page renders it as "My items" above
the payouts.

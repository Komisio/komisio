# Account deletion operations

The mobile app accepts an authenticated deletion request under **Profile →
Delete account**. No email, phone call, store membership or extra phone
verification is required to initiate it. Komisio handles the request manually
and responds within one month. A receipt is not completed deletion.

## Daily handling

An actual platform host opens `/host/account-deletion`, outside support mode.
Review the queue daily, including all pages. The deadline is a response deadline;
do not silently leave a case pending when goods, payments or retention need work.
Use **Start handling** to claim the case. Events are append-only and concurrent
handlers cannot advance the same revision twice.

Before removing contact details, arrange a secure way to deliver the completion
confirmation. Never copy names, addresses, email addresses, tokens or screenshots
containing them into GitHub, the case's retention reason or its confirmation
reference. Use an internal correspondence reference instead.

## Review and execute

1. Verify the request's user UUID against Supabase Auth. Inventory current
   identities, store memberships and seller links before removing Auth. The queue
   includes seller IDs captured at submission and current explicit/verified-email
   links. Recheck after starting handling and immediately before erasure: it is an
   aid, not a complete inventory of historical aliases, imports or external copies.
2. In each linked store, its real owner/admin uses the existing seller privacy
   screen (`/intake/sellers/<seller-id>/privacy` with that store selected).
   Resolve goods, balances, fees, payouts and outstanding deliveries through their
   normal engine operations. Then use the reviewed contact-erasure command and
   record retained evidence and the next retention review. Do not give a host
   artificial membership, impersonate a store owner, zero a balance, delete a
   ledger row or suppress a privacy blocker to finish a case. An owner/staff
   account also needs legitimate ownership transfer and membership removal.
3. Inventory central requests, uploaded and derived images, AI analyses, shipping
   addresses/labels, notification payloads, messages, exports and processor copies
   belonging to this UUID and the linked seller IDs. Remove personal data and files
   that have no continuing basis to retain them. Retain only justified contractual,
   accounting or dispute evidence, with its reason, restricted access and follow-up.
   The account queue does **not** execute this cleanup. For tables not covered by
   existing engine privacy operations, prepare a scoped, reviewed maintenance
   operation with an exact preview first. Do not disable immutable-record triggers
   or guess that every historical request or photograph must be retained.
4. Remove ordinary account profile data, revoke tenant memberships, remove/disable
   push devices and remove push tokens. Stop pending communications where
   appropriate. Check processors and backup retention under the applicable
   operating procedure. Backups must not silently restore a deleted login or
   reintroduce erased contact data into the live system.
5. A trusted operator uses Supabase Auth administration to delete the account and
   revoke its sessions and linked identities. Use the official admin deletion API
   or dashboard, never a service-role key in the mobile app or public API. Where
   immutable records reference the user UUID, Supabase's soft deletion can preserve
   the tombstone; this alone does not erase application records or storage files.
   Verify the identities and sessions are gone, not merely that the user is banned.
   Do not directly edit `auth.users` to simulate successful Auth deletion.
6. Verify sign-in and refresh are no longer possible. Already issued JWTs can
   outlive Auth removal; account-deletion RPCs check the live Auth user and session.
   Review retained-data access separately. Deliver the completion confirmation,
   explaining any retained categories and reasons without claiming blanket erasure.
7. Refresh the case. Every system check must pass before **Record completed
   deletion** is enabled. Supply the personal-data/processor review attestations,
   Apple handling, retention reason and confirmation reference. This records an
   already executed deletion; it does not perform one. If an operation is missing
   or cannot be verified, keep the case in progress and respond within its deadline.

Never test this procedure on a real account as part of a release smoke test.
Use a disposable, explicitly designated test account and synthetic store data.

## Sign in with Apple

Revoke Apple's refresh/access token through Apple's revoke API when a usable
token is held. Current native sign-in exchanges an identity token with Supabase;
the app does not retain an Apple refresh token. An identity token or a Supabase
refresh token cannot substitute for an Apple token.

For existing accounts without usable Apple tokens, follow Apple's documented
fallback: still fulfill the deletion, send the user [manual revocation
instructions](https://support.apple.com/102571), and record `manual_instructions`.
Do not make the user log in again or require them to finish that optional step
before deleting their Komisio account. The iOS app monitors native credential
revocation events and ends the corresponding local session. Other sign-in methods do
not turn an Apple revocation into a second deletion request.

Sources: [Apple account-deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion),
[Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple),
[Supabase admin deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser),
[Supabase user-data management](https://supabase.com/docs/guides/auth/managing-user-data).

## Scope and release verification

No request/status command deletes goods, balances, financial evidence, store
memberships, Auth users or files. There is no automatic erasure worker, retention
expiry job or new privileged deletion credential in this implementation.

Check request confirmation, retry after a lost response, app restart/status,
cross-account isolation, the host queue, stale concurrent handling and rejection
of premature completion. Also verify an Apple revocation on a real iPhone;
`getCredentialStateAsync` is not supported by the simulator. Release verification
must distinguish this physical-device check from unit/browser/database tests.

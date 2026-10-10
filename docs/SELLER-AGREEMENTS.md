# Seller agreement evidence

Stores publish immutable agreement versions. A seller can accept the current
version in the seller portal; staff can also record a reference to approval
obtained outside Komisio. These are distinct evidence sources. Portal acceptance
identifies the authenticated account, not an independently verified legal identity.
Komisio does not review the terms or provide a certified e-signature service.

## Seller journey

1. Sign in with the verified email uniquely linked to the store's seller record.
   Select the store and open its agreement from the seller portal.
2. Read the published version and choose **Accept**. The surrounding interface
   follows the portal language; the agreement retains its published language.
3. The page shows the acceptance time. Printing or saving through the browser's
   print dialog is available; printing alone never records acceptance.

Staff can see the version, time, account email and portal provenance in the
seller's agreement evidence. An existing staff-recorded acceptance is labelled
separately. Publishing new terms does not rewrite earlier evidence or receipts.

## Staff journey

The agreement workspace has separate **Agreements**, **Acceptances** and
**New agreement** tabs. The paged version list shows each text's language,
publication date and active/previous status. Selecting a version also selects
the acceptance register: search sellers and filter accepted or missing evidence
for that exact version. A missing acceptance does not imply that an older version
was never accepted. Staff and seller-portal evidence retain their distinct source.

When registering a seller or editing their details, staff can explicitly check
that the displayed agreement has already been signed/accepted and supply a
reference to the retained original. The engine saves the profile and evidence in
one transaction. A superseded version refuses the whole change; a lost-response
retry returns the original facts. An unchecked box creates no evidence and never
revokes existing evidence. The seller's Terms tab also offers printing and a
separate evidence form, open by default when the current acceptance is missing.

1. Open **Seller agreements** from Intake or Store settings. An owner/admin enters
   the store's own plain text, selects its language and chooses whether evidence
   is required before receiving. Review and publish an immutable new version.
2. Find the seller in Intake. Read the current agreement and its language. If an
   approval already exists outside Komisio, staff records a reference to the
   retained original, for example a paper identifier. This is explicitly a staff
   record, not the seller's signature. The time shown is when staff recorded it.
3. Receive the bag. When the policy requires evidence, receiving is blocked until
   evidence exists for that seller and current agreement. The receipt stores the
   exact version and evidence identifiers used. Open its label/detail page to
   inspect them; evidence references are excluded from the printed bag label.

The agreement's receiving flag and the store policy's agreement requirements
remain authoritative. A version with its receiving flag off does not override
a store policy that requires evidence. Seller acceptance does not itself receive
goods or authorize a sale. All staff/readonly members can read terms and evidence
in their own store; readonly cannot record or publish.

## Version and retry contract

Publications and evidence are append-only, with actor identity and an audit
event. Updating/deleting published text or evidence is rejected in PostgreSQL.
An admin's draft keeps its reviewed base version until deliberately reloaded or
the next version is prepared. A concurrent publication causes a visible conflict,
not a silent overwrite. Drafts are not persisted across a browser reload.

Publication, evidence recording, receiving and membership changes serialize on
the store. New receiving requests must include the displayed agreement version.
An old tab is rejected after a new publication, even when the old evidence was
valid. Successful retries resolve before checking current policy and preserve
the original receipt. Reusing a request ID with different content is a conflict.

Agreement text has one explicit language in this slice. It is rendered as plain
text, with no implicit translation or HTML execution. Missing evidence is never
inferred from a translation failure or a staff user's login.

Portal acceptance uses `POST /api/seller/agreement`, the engine adapter and
`accept_my_seller_agreement`. The request pins tenant, seller, agreement version
and request ID; actor and verified email come from the authenticated identity.
Database authorization uses the existing seller linkage and MFA boundary, not
staff membership or client-supplied identity. `my_seller_agreement` exposes only
that seller's current agreement and relevant acceptance.

A new request for an obsolete version returns `AGREEMENT_CHANGED`; the seller
reloads and reads the new version. A successful request can be retried after a
new publication and still returns its original evidence. Concurrent requests by
the same account for the same seller/version produce one acceptance record.

## Delivery and rollback

Apply all committed migrations through the repository's release workflow.
The original agreement migration is `20260911150000_seller_agreements.sql`;
`20261009110000_seller_portal_agreement.sql` adds portal acceptance using the
existing evidence table and preserves existing rows as `staff_recorded`.
Deploy the compatible application after the database migration. The existing
`KOMISIO_INTAKE_ENABLED` flag covers this feature; no additional activation
flag or signing-provider credential is required.

Once terms have been published, the pre-agreement UI cannot start new receipts
against an unseen version. For a release failure, disable the intake surface
and restore a compatible application; retain all version/evidence rows and apply
forward fixes. Do not remove evidence or turn a required policy off to work
around an authorization failure.

## Verification and next boundaries

The agreement database tests are `supabase/tests/0005_agreements.test.sql` and
`supabase/tests/0286_seller_agreement_portal.test.sql`. They cover scoped reads,
actor-bound evidence, immutability, required evidence and version/retry rules.
`scripts/seller-agreement-race.mjs`, included in the concurrency suite, checks
competing acceptance requests. `tests/e2e/seller-agreement.spec.ts` covers portal
acceptance, uncertain-response retry, reload, new-version conflicts and mobile
layout. Full main CI gates the staging release under the repository merge policy.

Evidence correction/revocation, independent identity verification, signed-file
attachments and translated versions of the same agreement remain separate work.
AI-generated drafts require review and ordinary explicit publication; generating
a draft never records seller acceptance. Tests use synthetic accounts and terms,
not real seller approvals. Hosted authenticated acceptance and the store's legal
suitability checks are separate from automated regression coverage.

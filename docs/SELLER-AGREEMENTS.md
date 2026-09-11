# Seller agreement evidence

This staff pilot adds versioned store terms and references to approval evidence.
It does not provide seller login, electronic signatures, BankID, legal review or
financial authorization. Use synthetic terms and evidence while evaluating it.

## Staff journey

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

No published agreement means no new prerequisite. An optional-evidence version
allows receiving without evidence. Changing the requirement publishes another
version; it never rewrites existing receipts. All staff/readonly members can
read terms and evidence in their own store; readonly cannot record or publish.

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

## Delivery and rollback

Apply migration `20260911150000_seller_agreements.sql` to the verified staging
project after CI passes and before merging/deploying the new application. It is
additive for existing receipts and keeps the previous receiving function for
no-agreement stores and unchanged old retries. Do not publish agreements until
the new UI has deployed. The existing `KOMISIO_INTAKE_ENABLED` flag covers this
slice; no additional activation flag or provider credential is required.

Once terms have been published, the pre-agreement UI cannot start new receipts
against an unseen version. For a release failure, disable the intake surface
and restore a compatible application; retain all version/evidence rows and apply
forward fixes. Do not remove evidence or turn a required policy off to work
around an authorization failure.

## Verification and next boundaries

Local coverage: 112 pgTAP assertions across the project, 32 unit tests and nine
browser journeys. Concurrency checks cover ownership, receipt replay, competing
publications and publication racing receipt. The agreement browser journey
covers required evidence, version change, stale forms, historical receipt links,
literal HTML text and mobile layout. Full CI must pass before merge.

Before external pilot use, add evidence correction/revocation with append-only
events and define when evidence needs renewed verification. Seller-authenticated
acceptance, identity matching, document attachments, retention requirements,
multiple translations and automated agreement drafting remain separate work.
No live legal terms or real seller approvals are synthesized for tests.

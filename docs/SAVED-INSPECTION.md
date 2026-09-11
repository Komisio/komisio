# Saved inspection drafts

The staff pilot lets a store describe individual goods in a received bag and
resume that preparation later. A saved draft is not commercial acceptance,
completed inspection, sale eligibility or a catalogue product. No model, price,
VAT, commission or POS operation is introduced.

## Journey

Open **Inspect the bag** from Intake or the bag label. Add a description and
optional category/observed condition, then explicitly save. The success message
links to the saved draft or to the next new item. Reopen a draft to edit it.
Unsaved edits are browser-only and lost when leaving/reloading, as the form says.
A successful save survives reload and can be resumed by other permitted staff.

The page lists the latest revision of the 50 most recently saved drafts in the
bag. Direct draft links resolve independently of this list. Pagination, history
browsing, retirement of mistaken drafts and completion of an entire bag remain
follow-up work; do not interpret an absent list row as deletion.

## Shared engine and minimal persistence

`saveInspectionCommand` reuses the descriptive fields in the AI-first contract.
The GUI calls `/api/intake`, which validates the current authenticated context and
executes the same engine command intended for future authorized adapters.
There is still no machine credential or agent execution endpoint.

`inspection_draft_revisions` is one append-only table, linked to the bag with a
composite tenant foreign key. Seller identity is derived through the bag, not
supplied independently. The `inspection_current` view uses `security_invoker`
so RLS/MFA applies to the actual caller. Only owner/admin/staff may save;
readonly may read. Direct inserts/updates/deletes are not granted. Database
triggers preserve previous revisions even outside application grants.

Persisted revision 0 means a new draft; the first save stores revision 1.
This differs from the in-memory edit counter used to invalidate AI proposals.
The save operation locks the store row, serializing with membership changes and
other saves. A stale expected revision fails without replacing another person's
work. A draft cannot move between bags or stores. The actor comes from verified
authentication, never a submitted identity.

Each save has a stable request UUID bound to actor, bag, draft, expected revision
and content. Retry resolves the original saved revision even if another revision
has since been saved. The GUI freezes the request after an ambiguous failure;
retry sends it unchanged. On conflict, edits stay visible for copying, and the
user explicitly opens the current version. It never silently updates its base.
Audit records contain references/revision, not descriptive or contact content.

## Verification and deployment

Local verification covers 139 database assertions, 47 unit tests, a real
two-connection edit/retry race and a browser journey with saved-state reload,
lost successful response, duplicate retry, stale tab, literal text and mobile
layout. Full project browser/lint/type/build and exact-head CI are checked before
merge. Database tests also cover readonly, another staff editor, revoked
membership, MFA, cross-store bags, immutable history and anonymous denial.

Apply additive migration `20260911180000_inspection_drafts.sql` to the verified
staging project before application merge/deployment. The existing intake flag
enables this slice. Do not run local test scripts against hosted data. Perform
the hosted walkthrough only in the explicitly synthetic test store.

Rollback: an earlier compatible application can be redeployed because the new
schema is additive; retain draft revisions. If intake itself fails, hide it with
the existing flag while investigating. Do not delete history to recover a save.
There are no new provider credentials or dependency costs in this slice.

Before real store use, decide draft retention, retirement/correction presentation,
commercial acceptance and photo provenance. Model assistance and durable agent
approval remain separate, optional layers above the same core operations.

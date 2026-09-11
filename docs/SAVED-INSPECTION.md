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

The page lists 20 drafts at a time in stable draft-ID order with next/previous
navigation. Editing a draft does not move it between pages. New drafts can be
inserted while browsing, so this is a live list rather than a point-in-time
snapshot; return to the first page to browse again. Direct draft links resolve
independently of the currently displayed page.

Selecting a draft exposes its revision history, 20 versions at a time. Each
version has a direct link and timestamp. A historical version is read-only and
appears alongside the latest saved details for comparison. The editor is absent
when a historical revision is selected; an explicit link returns to the current
draft. No restore/overwrite action exists. All historical reads use the caller's
session, current store, bag and draft filters; invalid or inaccessible references
do not reveal a different store's data. Draft retirement and completion of an
entire bag remain follow-up work.

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

Local verification covers 166 database assertions, 52 unit tests, a real
two-connection edit/retry race and a browser journey with saved-state reload,
lost successful response, duplicate retry, stale tab, literal text and mobile
layout. Full project browser/lint/type/build and exact-head CI are checked before
merge. Database tests also cover readonly, another staff editor, revoked
membership, MFA, cross-store bags, immutable history and anonymous denial.
The inspection form stays disabled until client handlers are attached. A
delayed-JavaScript regression test demonstrated the pre-hydration editing gap
before the fix and passes with this guard; stale edits remain unchanged.
The history/pagination extension covers 22 revisions and 22 drafts, forward and
backward paging without duplicates, opening revision 1 outside the latest history
page, read-only historical rendering, current comparison and absent revisions.
It introduces no migration, new dependency, model provider or authorization rule.

Apply additive migration `20260911180000_inspection_drafts.sql` to the verified
staging project before application merge/deployment. The existing intake flag
enables this slice. Do not run local test scripts against hosted data. Perform
the hosted walkthrough only in the explicitly synthetic test store.

Rollback: an earlier compatible application can be redeployed because the new
schema is additive; retain draft revisions. If intake itself fails, hide it with
the existing flag while investigating. Do not delete history to recover a save.
There are no new provider credentials or dependency costs in this slice.

Before real store use, decide draft retention, physical goods disposition,
commercial acceptance and photo provenance. Model assistance and durable agent
approval remain separate, optional layers above the same core operations.


## Archive and reopen descriptive drafts

Staff can archive an erroneous draft with a required reason, then explicitly
reopen it with another reason. Both operations copy the last saved description
into a new immutable revision, with authenticated actor and status. They do not
record a physical return, disposal, commercial acceptance or sale. Unsaved edits
are not included; the UI explains this before confirmation.

The list defaults to active drafts. Archived/all filters apply to the current
view, not to historical revisions, so an old active revision cannot reappear as
current. Direct links and history preserve access to archived drafts. Descriptive
editing is disabled until explicit reopening. The reviewed revision is captured
when the status form opens; a concurrent change rejects it without replacing the
user's input. Existing request IDs return their original results, even after
reopening, and cannot be reused across save/status operations. The success message
acknowledges the recorded operation; it does not assert the present status.

The shared engine exposes a separate strict archiveInspection command. Description
suggestions cannot set its status or reason. Skills may explain these operations,
but permission, revision checks and immutable history remain database guarantees.
No new table, model provider or credentials are needed.

Verification includes mandatory reasons, preserved descriptions, original-save
replay after archive, archive replay after reopening, operation/actor binding,
readonly/MFA/membership isolation and a real two-connection archive/edit race.
The browser regression covers archive, active/archived filters, stale-tab edits,
reopen, historical status/reason and replay without reactivation or extra history.

Apply additive migration 20260911210000_inspection_archive.sql to the verified
staging project before deploying this UI. Old revisions become active; no history
is deleted. Older applications do not understand archived state: although the
new database still blocks editing archived drafts, prefer a compatible application
or temporarily hide intake with the existing flag while applying a forward fix.
Do not revert the schema or delete revisions as rollback. Failures to load history,
incorrect current status or unauthorized changes are reasons to stop the rollout.

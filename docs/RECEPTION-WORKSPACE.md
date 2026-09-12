# Operator reception workspace

Open /intake/reception from the existing intake page. Search for a registered
seller and start a single-garment session, or resume one of the latest 20 sessions.
An exact reception UUID opens older sessions; all reads remain scoped to the
active tenant and RLS. The initial search returns at most 50 sellers and explicitly
asks operators to refine it. Registration remains in the existing intake surface.

One guided page wraps the existing shared operations: save source evidence,
preview the persisted proposal and full current terms, explicitly publish an
immutable review, then issue/replace/revoke a personal seller link. The operator
default is an explicitly displayed 24-hour review validity, inside the engine's
seven-day bound. It is a pilot UI default, not yet tenant-configurable policy.
No table or financial rule is added by this surface.

Until a real provider is configured, the workspace is explicitly manual. A small
adapter in lib/engine/manual-reception.ts encodes description and appraisal in
versioned source payloads, validates decimal text without floating-point math,
and decodes only its own format. It never infers a price from arbitrary prose.
Manual corrections receive new source IDs; other source evidence is preserved.
Appraisal reference and rationale become part of the reviewed price explanation.
This representation is transport metadata, not an authorization or accounting
rule. The database still independently enforces source linkage and all writes.

The operator previews the saved source revision, not unsaved form contents.
Changing sources invalidates old seller links; immutable history and responses
remain. The link recipient shown for a published review is its pinned email,
not a subsequently changed seller record. A lost save response can retry its exact
request. Conflicts require reloading the saved state; they cannot overwrite newer
work. Link actions wait for refreshed access state before another action is enabled.
Lost link-issuance responses use the replacement recovery documented in
[seller review](SELLER-REVIEW.md). No email is sent automatically.

Readonly users can inspect the review but do not receive write controls. The
source/review response still does not establish physical custody, sale eligibility,
general seller agreement evidence or payout authorization. Protected photos,
live AI and authenticated agent transport remain next; this GUI does not replace
those adapters or label manual preparation as AI output.

The browser journey exercises real operator controls, a deliberately lost success
response, exact review publication, rapid link replacement/revocation, stale-editor
rejection and mobile layout. Existing mobile seller and database journeys verify
the other side of the shared operations. Hosted synthetic verification is recorded
separately; do not infer real mail or live vision from local fixture results.

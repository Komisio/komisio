# Unsaved inspection proposal preview

An explicitly scoped MCP host can submit proposed description/category/condition
changes for an existing active saved draft at its exact current revision. The
shared engine reads that draft with staff RLS/MFA, validates the existing strict
descriptive contract and returns before/after fields plus an explicit change list.
It reuses the pure draft edit and preview functions; no second field model exists.

`komisio_preview_inspection` requires `inspection:preview`, separately from reads.
The host fixes the tenant. Unknown keys, financial/authority fields, missing or
wrong-bag drafts, archived drafts and stale base revisions fail. A description
cannot become empty; category and condition may be explicitly cleared, matching
the existing manual draft contract. No-op suggestions return an empty change list.

The result is unsaved, unstaged and unapproved. It references the actual saved
base revision, not the temporary in-memory edit counter. Read-time freshness is
not a lock or a guarantee that the draft remains current. Human review and any
staged write must recheck the exact revision; this preview supplies no write
authorization. Staff manual editing and approved staged inspection edits both
use the existing save command. The preview itself introduces no persistence.

The tool does not call a model, supply price, infer consent or turn staff text
into observed reception sources. All text remains untrusted; bag notes, contact
fields, history and unrelated drafts are omitted from the result. Existing local
MCP credential limitations apply. Verify real stdio preview/no-op/clearing,
stale/archive/identity/MFA denial and unchanged persisted versions.


## Descriptive inspection edits

The existing pending-operation mechanism also supports `saveInspectionDraft`.
It stages a complete descriptive edit to an existing active draft at an exact
saved revision. Staff review the historical before/after and confirm changed
fields before approval executes the existing save command. Rejection requires no
field confirmation; stale or archived drafts cannot be overwritten. Inspection
and reception MCP reads remain separately scoped and kind-checked. The unsaved
preview tool remains read-only. See [contract](STAGED-INSPECTION.md) for the
strict payload, retry behavior, actor attribution and release boundary.

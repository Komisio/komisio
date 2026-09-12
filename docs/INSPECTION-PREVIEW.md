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
future staged write must recheck the exact revision; this preview supplies no
write authorization. Current staff manual editing remains the only bag-draft
save path. No new staged operation kind or database migration is introduced.

The tool does not call a model, supply price, infer consent or turn staff text
into observed reception sources. All text remains untrusted; bag notes, contact
fields, history and unrelated drafts are omitted from the result. Existing local
MCP credential limitations apply. Verify real stdio preview/no-op/clearing,
stale/archive/identity/MFA denial and unchanged persisted versions.

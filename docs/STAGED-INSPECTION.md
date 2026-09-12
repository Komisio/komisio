# Staff approval of descriptive inspection edits

Extend the existing pending-operation mechanism with `saveInspectionDraft` for an
existing active draft only. No new table or financial meaning is introduced.
The immutable payload contains bag/draft IDs, exact expected revision and the
complete proposed description/category/condition. The exact historical base is
read from existing append-only revisions, not a model-supplied before snapshot.

The proposer supplies an explicit stable expiry and request ID. SQL validates
staff identity/MFA, bag ownership, active current revision and strict bounded
fields, and derives low risk just as for existing descriptive review publication.
No-op payloads fail. Retrying the identical envelope returns the original proposal;
changing its fields, actor or expiry conflicts. No draft is saved at proposal time.

Staff review the exact before/after delta in the existing operation detail page.
Approval executes `save_inspection_draft` as the approver, inside the existing
decision transaction. The operation ID is the save request ID; result ID links
the resulting immutable draft revision. The revision retains the approver as actor, while
the pending operation retains the proposing agent identity. A stale or archived
draft cannot be overwritten; failed execution is recorded without a draft change.
Rejection records only a decision. Existing expiry, role and retry rules apply.

The UI requires confirmation for each changed field before approval. This is a
review aid, not a separate database permission or claim that a checkbox proves
attention. The approved immutable payload is applied as a whole; to change a
subset or wording, reject and create a new proposal. Rejection does not require
field confirmation. There is no automatic approval scope or MCP decision tool.

Use `inspection:propose` only when explicitly configured. The new tool stages a
complete payload against the exact base, without calling a model or saving it.
The inspection operation detail tool reuses the shared detail engine under
inspection read scope, with kind-specific checking; one read scope must not grant
the other operation kind. Existing reception clients keep their tool name and
behavior. No bag note, seller contact, reception evidence, custody,
price, terms or sale acceptance is added to the inspection operation.

Verify SQL payload/role/MFA/tenant/replay/expiry/immutable/failed execution,
concurrent approval versus staff edit, real MCP staging/read boundaries and staff
browser approval/rejection. Publish only after the new application can read both
kinds; disable the new proposal path until the additive migration is applied.


Release recovery: stop configuring `inspection:propose` if the new path fails;
retain the additive migration and immutable proposal/decision records. Once any
new-kind proposals exist, do not roll the UI back to a version that only parses
reception operations. Fix forward or disable intake temporarily while preserving
staff/manual data; never delete history to make a rollback work. Hosted MCP and
live model inference are not enabled by this release.

# Staged operations

The first write path for non-human actors. An agent proposes; a person decides;
execution reuses the engine function the person could have called directly and
records that person as the actor. Nothing an agent does is a fact until then.

## Shape

| Record                | Meaning                                                                                                                                        | Mutability  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `pending_operations`  | One proposal: tenant, kind, structural payload, derived risk level, actor kind and label, the user whose session proposed it, expiry           | Append-only |
| `operation_decisions` | Exactly one decision per operation: approved or rejected, outcome executed, failed or rejected, result ID or error code, reason, deciding user | Append-only |

Derived status for lists: `open`, `expired`, `executed`, `failed`, `rejected`.

## Rules enforced in SQL

- Proposing requires an authenticated owner, admin or staff session with
  confirmed email and the existing MFA requirement when enrolled, in the target
  store. Readonly cannot propose.
- Risk level comes from the kind. The proposer cannot supply it. The first kind,
  `publishReceptionReview`, is `low`.
- The payload is validated structurally per kind, then preflighted against the
  same preconditions the engine function enforces: session in store, current
  source revision, expected previous review, current terms, review expiry within
  seven days, every fact cites a known source, price cites price evidence.
- Proposals expire within seven days. Expired proposals can be rejected, never
  approved.
- Deciding requires owner, admin or staff. Low-risk kinds may be approved from
  the session that proposed them; medium and high kinds require another person.
- Approval calls the engine function inside the same transaction, as the
  approver. Success records `executed` with the result ID. Any engine error
  records `failed` with the error code; the operation cannot be retried, a new
  proposal is needed. Rejection records a reason and executes nothing.
- Retries with the same request ID return the original result; a different
  decision under the same ID fails with `REQUEST_CONFLICT`.
- Every proposal and decision writes an access event.

## Surfaces

- MCP: scope `reception:propose` adds `komisio_propose_reception_review`. The
  host supplies the complete review payload; the tool validates source bindings
  against the current revision, then stages. It returns `persisted:true`,
  `staged:true`, `executed:false`, `requiresApproval:true` and the operation ID.
  An optional `requestId` lets a host retry a lost response safely.
  The operation expires at the proposed review's fixed `expiresAt`, so a retry
  carries the identical envelope and never extends the approval window.
- Web: `/intake/operations` lists the newest 50 proposals for the active store.
  Its detail link shows the exact source snapshot and agreement terms before a
  decision. Stale/expired proposals can be rejected but not approved in this UI;
  SQL rechecks all preconditions. Readonly can view. See OPERATION-REVIEW.md.
- MCP: `komisio_read_reception_operation` shares that exact-context read under
  `reception:read`. It returns no photo paths or seller contacts and cannot decide.
- API: `POST /api/operations` takes a decide command; same-origin, session,
  active-store and role checks precede the SQL function, which checks again.

## What this does not do

No auto-execution scope, no hosted delegated credentials, no notification,
no kinds beyond review publication. An executed review is a staff-published
review with the usual seller link flow after it; it is not commercial
acceptance, custody or a payout. Per-fact confirmation of model output before
publication remains separate work; today the proposer must present all facts as
observed and the approver confirms the whole.

## Verification

`supabase/tests/0015_pending_operations.test.sql` covers proposal validation,
replay, role and MFA denial, execution as approver, failed execution, rejection,
expiry, self-approval by risk, immutability and audit. `npm run test:concurrency`
races two approvers on one proposal. `npm run test:mcp` stages through real
stdio and approves through the authenticated database RPC. The operator browser
journey separately exercises the web decision form and `/api/operations` route.

Apply `20260912140000_pending_operations.sql` before deploying this version.
An older application ignores the new tables and functions.

## Descriptive inspection edits

The existing pending-operation mechanism also supports `saveInspectionDraft`.
It stages a complete descriptive edit to an existing active draft at an exact
saved revision. Staff review the historical before/after and confirm changed
fields before approval executes the existing save command. Rejection requires no
field confirmation; stale or archived drafts cannot be overwritten. Inspection
and reception MCP reads remain separately scoped and kind-checked. The unsaved
preview tool remains read-only. See [contract](STAGED-INSPECTION.md) for the
strict payload, retry behavior, actor attribution and release boundary.

Staff reception approval now requires each included descriptive field and price
to be checked before final confirmation. This shares the pure field catalogue
with built-in AI review; it is a review aid, not a new SQL permission or proof of
attention. Rejection remains available without confirmations. See
[per-fact review](RECEPTION-FACT-REVIEW.md).

## Commercial acceptance

Since migration `20260913220000` the mechanism also supports `acceptItem` at
risk `medium`: an agent stages acceptance of one origin (inspection draft at
an exact revision, reception review at an exact version, or purchase receipt)
at an integer öre price. Preflight checks the origin is current, not already
accepted and, for a reception review, in custody. Approval by a different
identity than the proposer runs `accept_item`, which re-checks the agreement
prerequisite and the seller review mode and freezes the terms; the item id is
the operation id. The MCP tool `komisio_propose_acceptance` needs the scope
`items:propose`. `supabase/tests/0029_staged_accept_item.test.sql` covers
validation, preflight, self-approval denial, approval by a second person and
a competing proposal failing at execution with `ITEM_EXISTS`.

## P2 kinds: returns, ledger adjustments, markdown batches

Since migration `20260914090000` three more kinds exist. `recordReturn`
(`medium`) stages a full refund of one completed, unreturned sale line at
exactly the line price; approval by a second person runs `record_return` with
the operation id as the return id. `adjustLedger` (`high`) stages a signed
öre adjustment with a reason; execution runs `adjust_seller_ledger`, which is
owner or admin only, so a staff approval records `failed|FORBIDDEN` and moves
nothing. `applyMarkdownBatch` (`low`) stages up to 50 items each with the step
that is due right now; preflight refuses the whole batch if any step is not
due, and execution applies one markdown event per item inside the approving
transaction, all or nothing. The queue lists and filters the new kinds; the
detail page shows the payload with an execution note and a stale hint (line
already returned, seller gone). No MCP tool proposes these kinds yet.
`supabase/tests/0040_staged_p2_kinds.test.sql` covers all three.

## Uncertain decision responses

The staff decision UI freezes the complete first submitted envelope: tenant,
operation, request ID, decision and reason. During a pending request and after an
unknown network result, inputs stay locked and only retrying that exact envelope
is offered. A retry does not ask the user to approve again or switch to rejection.
SQL still rechecks identity, membership/MFA and the existing request-id contract;
an already stored matching decision is returned without executing again. A known
HTTP rejection requires reloading the saved state. Reloading the page intentionally
reads authoritative state; it does not silently recreate an old decision request.
No database change, storage of browser credentials or new authority is introduced.

The staff queue now has a separate paged read contract in
[OPERATION-QUEUE-PAGING.md](OPERATION-QUEUE-PAGING.md). Status filters and older-page
links keep historical proposals reachable; decision authority stays in the same
commands. The original newest-50 RPC remains available for existing callers.

Staged reception detail compares the candidate with its exact pinned prior
publication; see [comparison contract](RECEPTION-REVIEW-COMPARISON.md). This is
read-only guidance. Unchanged facts still require confirmation; prior seller
responses never become consent to a new version. UI and MCP share this read.

## Adding a kind

Since migration 20260913090000 the kind-specific logic lives in private
functions and the two public functions only dispatch. To add a kind:

1. `komisio_private.operation_risk`: one `when` line returning `low`,
   `medium` or `high`.
2. `komisio_private.op_validate_<kind>(jsonb)`: structural validation, and
   one `when` line in `valid_operation_payload`.
3. `komisio_private.op_preflight_<kind>(tenant, payload) returns jsonb`: the
   same preconditions the engine function enforces, raising the engine's
   error codes; returns the audit detail. One `when` line in
   `propose_operation`.
4. `komisio_private.op_execute_<kind>(tenant, operation, payload) returns
uuid`: calls the engine function. One `when` line in `decide_operation`.
5. Extend the `pending_operations` kind check constraint, the zod
   discriminated unions in `lib/engine/operations.ts`, and the MCP scope if
   agents may propose it.

Every step is additive; the dispatchers are re-declared with one new line
each, never rewritten in substance.

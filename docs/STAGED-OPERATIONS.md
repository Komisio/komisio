# Staged operations

The first write path for non-human actors. An agent proposes; a person decides;
execution reuses the engine function the person could have called directly and
records that person as the actor. Nothing an agent does is a fact until then.

## Shape

| Record | Meaning | Mutability |
| --- | --- | --- |
| `pending_operations` | One proposal: tenant, kind, structural payload, derived risk level, actor kind and label, the user whose session proposed it, expiry | Append-only |
| `operation_decisions` | Exactly one decision per operation: approved or rejected, outcome executed, failed or rejected, result ID or error code, reason, deciding user | Append-only |

Derived status for lists: `open`, `expired`, `executed`, `failed`, `rejected`.

## Rules enforced in SQL

- Proposing requires an authenticated owner, admin or staff session with
  confirmed email and enrolled MFA, in the target store. Readonly cannot propose.
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
- Web: `/intake/operations` lists the newest 50 proposals for the active store
  with their derived status. Staff approve or reject with an optional reason
  after confirming they checked the reception. Readonly can view.
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
stdio and approves through the authenticated API.

Apply `20260912140000_pending_operations.sql` before deploying this version.
An older application ignores the new tables and functions.

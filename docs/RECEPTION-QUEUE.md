# Reception queue contract

Status: implemented locally; remote CI and deployment pending. Day-plan P2.
No new persistence is required. `reception_queue` reads under existing RLS;
`lib/engine/reception-queue.ts` validates the paged result for the thin list UI.
The queue is a staff read model over reception sessions, source revisions,
reviews, responses and access events. It does not execute a store decision.

## One row per session

Return session ID, seller display name, created time, current source revision,
latest review ID/version, reviewed source revision, response decision/time,
link availability and derived work stage. Do not return email, token hashes,
capability links, images or internal evidence in a list response.

Read latest records by their explicit revision/version, never timestamp alone.
Read all fields for a page in one database snapshot. Avoid per-row network calls
and a capped client-side scan followed by status filtering.

## Derivation order

| Condition, evaluated in this order | Work stage |
| --- | --- |
| No source revision or no published review | preparing |
| Latest review targets a different current source revision | needs_review |
| Exact latest review has an approve response | approved |
| Exact latest review has a decline response | declined |
| Unanswered review expiry is reached | expired |
| No access event exists | ready_to_share |
| Latest access event revokes the link | link_revoked |
| Current unanswered review and active access event | awaiting_seller |

Responses remain historical facts after expiry or revocation. They do not become
new consents when sources change. The list must distinguish `needs_review` from
its previous response so a past approval is never presented as current approval.
`approved` means only seller-approved review, not commercial acceptance or sale.
Link availability is a separate dimension: none, active, revoked, expired or
stale. Issuing a link does not prove delivery or that the seller opened it.
Use database transaction time for expiry and return an as-of time if useful;
this is a read-time view, not a continuously updating promise.

## Access and pagination

Use authenticated read access for owner/admin/staff/readonly, with confirmed
identity and enrolled MFA enforced by existing database boundaries. Tenant input
never grants access. Anonymous, seller-only and removed-member reads must fail
or return no rows consistently with existing engine conventions. No service key.

Order by immutable created_at descending and ID descending as tie-breaker.
An optional cursor contains both values; validate both or neither. Return20 rows
plus at most one lookahead, with a bounded next cursor. Filter by validated stage
inside the database before the limit. A current page is consistent, but changing
stages can move rows across separate visits; do not claim snapshot pagination
across changing filters. Reset the cursor when changing tenant or filter.

Prefer a narrowly granted SECURITY INVOKER function with lateral latest-row
queries and existing RLS, plus explicit identity/tenant checks consistent with
other read RPCs. Inspect existing indexes and query plan before adding any index.
No new core table, persisted status, financial column or materialized mirror.

The implementation uses existing session/source/review/version indexes. No
additional index is introduced for the small staging pilot; filtered queues can
scan many sessions and require query-plan/load evaluation before a large rollout.
Apply additive migration `20260912073000_reception_queue.sql` before the app.
An older app can ignore the new RPC; keep the additive migration on rollback.

## Adapter and verification sequence

1. Record the rule in DECISIONS.md; write pgTAP cases before the migration.
2. SQL read + typed shared engine wrapper. Test cross-tenant/role/MFA denial,
   no sources/review, each stage, source change after approval, replaced review,
   expired/revoked answered reviews, equal-time cursors and filtering before limit.
3. Thin reception list UI with translated state labels, filter and next page.
   Preserve seller search/start-session and exact-session lookup.
4. Existing staff/seller browser test should verify that responding changes the
   queue, and changing evidence stops showing that old approval as current.
5. Later reuse this read in MCP under the existing tenant-bound read scope. Do not
   add agent write permissions as part of a list operation.

A refreshable queue is useful without adding a new commercial workflow. Store
acceptance, physical custody, item numbers, label issuance and POS publication
remain separate P3–P5 decisions and must not be smuggled into these labels.

# Scheduled Zettle retrieval

Owner-selected model, 2026-09-14: [AUTOMATION-ACTOR.md](AUTOMATION-ACTOR.md),
not the superseded pg_cron/owner-actor proposal. Vercel Cron calls the GET route
`/api/automation/zettle-pull` every ten minutes. It authenticates the
`Authorization: Bearer <CRON_SECRET>` header before any sign-in, uses the ordinary
Supabase password grant for a dedicated identity, and signs out that session in
`finally` (local scope so overlapping invocations cannot revoke each other).

## Authorization and engine boundary

An owner explicitly grants `zettle_pull` to the configured identity. Acceptance
creates its automation membership. Each invocation lists all active accepted
grants, not only newly accepted ones, and only processes the server-pinned pilot
tenant. Merchant identity is checked against the connection in SQL and again by
the server provider adapter. No request parameter selects a tenant or merchant.
Disabled scope, removed membership and unmet MFA all fail closed in SQL.

Two additional role checks alone were insufficient: window ingestion calls page
reconciliation, then record_sale, then the current policy reader. Private shared
engine functions now supply those implementations. The public arbitrary sale,
unwindowed page and policy commands retain their original role checks. Automation
cannot export a product, close a window or edit financial rules. No core table or
staged operation kind is added. Facts identify the automation user; the grant
identifies the enabling owner. The adapter does not write tables.

## Bounds and recovery

One run reserves at most one page of 100 receipts per store per ten-minute UTC slot.
Reservation uses immutable access events under the tenant lock. Duplicate cron
deliveries do not repeat provider HTTP work. A crash leaves a started event; the
next slot resumes the durable window cursor. A lost database response never causes
an unverified success event. Committed pages and receipt IDs remain replay-safe.
The usual empty page completes the window; older backlogs may take several runs.
The provider timeout is 15 seconds per page; the route runtime ceiling is 60 seconds.

The integrations page displays the grant and last bounded outcome: started (not
confirmed), received, complete, waiting, or failed. Failure detail is deliberately
not the provider's body. A revoked in-flight run cannot commit a page. A permanently
bad page remains held; an owner may use the separate logged window-abandon command.

## Deployment and activation

1. Merge with green platform CI. GitHub applies migrations `20260916050000` and
   `20260916060000` in order to staging. The latter qualifies a cursor column found
   ambiguous by local pgTAP; the already locally applied first migration is retained.
2. The owner creates a dedicated, confirmed Supabase Auth user, not a staff/owner
   account, without enrolled MFA as specified by Fable. Configure server-only
   `KOMISIO_AUTOMATION_EMAIL`, `KOMISIO_AUTOMATION_PASSWORD` (at least 16 characters)
   and random `CRON_SECRET` (at least 16 characters) in the target Vercel environment.
   Do not put them in GitHub source, screenshots, client variables or this log.
3. The existing pilot merchant/tenant/provider settings and intake flag must remain
   configured. After deployment, the owner enables **Fetch receipts automatically**
   in the connected store's integrations page. Nothing enables a grant by default.
4. Verify an actual scheduled invocation, its automation acceptance/access events,
   page actor and matched receipt in the POS; append the dated observation to
   [ZETTLE-LIVE-PULL.md](ZETTLE-LIVE-PULL.md). Automated fixtures are not live evidence.

Missing identity, cron secret or Supabase configuration yields 404; a wrong cron
header yields 401. New status reads tolerate only missing-function PGRST202 during
the deployment gap. Cron is deployed on Vercel's production deployment; preview
deployments do not provide proof that it runs. Every-ten-minute scheduling requires
a suitable Vercel plan. See [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
Self-hosting may call the same authenticated GET route from an external scheduler.

## Stop / rollback

Disable the store's automation grant to stop subsequent database writes, including
an in-flight page. Remove the cron configuration or secret to stop new invocations.
Do not delete audit events, undo sales or roll back migration history; financial
corrections use existing engine commands. Reverting the app leaves additive SQL
compatible with manual retrieval. Inspect held receipts before abandoning a window.

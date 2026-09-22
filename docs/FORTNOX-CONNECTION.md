# Fortnox connection

## Store-owned accounts

Each tenant can connect its own Fortnox company from /intake/integrations.
The host configures FORTNOX_CLIENT_ID, FORTNOX_CLIENT_SECRET and
KOMISIO_CREDENTIAL_KEY, and registers the /api/integrations/fortnox/callback
URL with Fortnox. A deployment pilot tenant is no longer required.
Owner/admin supplies the company name before OAuth; signed state binds it
to the tenant. The callback verifies the company before storing encrypted
tokens. Reconnecting retains the saved company database pin.
Scheduled sending enumerates accepted tenant grants; connecting never enables
automation or sends a voucher. Live authorization requires the host's registered
OAuth integration; synthetic tests do not verify its registration or approval.

## Revision-bound refresh database prerequisite

Migration `20260916100000` introduces `refresh_fortnox_tokens` for an already
connected company. It accepts the revision read from `read_fortnox_connection`;
revisions are decimal strings in JSON to avoid JavaScript bigint precision loss.
Every connection update and reconnect receives a new private sequence value.
Refresh serializes with connection changes and cannot change company metadata
or create a row. Owner/admin or accepted `fortnox_send` automation may call it;
other connection permissions remain unchanged.

A stale revision returns `{ "error": "FORTNOX_CONNECTION_CHANGED" }` as data,
not a failed database transaction: both the connection refusal and access event
must remain committed. Callers must inspect this result before using new tokens.
Success returns `{ "status": "refreshed", "revision": "..." }`. No tokens
appear in either result or audit events.

The application now renews through this RPC, never through the general connection
store command. A conflict drops the obtained tokens and rereads once, using the
new valid access token or renewing that new revision. Another conflict stops.
A missing revision stops before external renewal during a deployment gap. A save
error drops the rotated tokens without retry and reports a reconnect/check hint;
a verified provider `invalid_grant` reports that reconnection is needed. Only
allowlisted reasons and the read revision enter refusal events. Logging during a
database outage is best effort; no unavailable database can guarantee the event.

The OAuth callback still verifies the company before storing a connection.
The connection panel offers renewal through OAuth without disconnecting first,
so the existing company database pin is retained. Saved refusal events display
the same reconnect guidance on a later page load.
Connect, check and disconnect still require owner/admin in the application.
The token read/refresh used by sending now relies on the database's owner/admin
or accepted `fortnox_send` scope check. No real token was renewed as part of
the synthetic validation of this change.

## Daily automatic sending

Migration `20260916110000` opens begin/complete/check-event commands to the
accepted `fortnox_send` scope only. The worker signs in as the ordinary configured
automation identity with the publishable key, accepts grants, lists its accepted
stores, processes their explicitly authorized connections, and signs out locally in
all cases. No service-role client or borrowed owner session is involved.

An owner enables or disables the existing grant on accounting settings. The
panel shows pending acceptance and the last recorded run. Staff can see the run
summary but cannot toggle the grant. Cron calls `/api/automation/fortnox-send`
daily at 07:00 UTC using `CRON_SECRET`. Deployment does not enable a grant.
First connect the intended company, record the day close/export, and explicitly
enable the switch. The next cron accepts it. Do not trigger the live route as a
test: it can create real vouchers for eligible exports.

The queue contains at most 100 exports with no send history or exclusively
`FORTNOX_PREFLIGHT_FAILED` history. Pending/sent/unknown sends and legacy failures
remain excluded. Each send obtains its own fresh engine dispatch claim; concurrent
workers cannot bypass it. One failure stops that store. After 200 seconds no
further send starts; remaining exports wait for another run. A full 100-entry
batch is conservatively reported as partial. Day closes remain manual.

Run summaries are replay-safe append-only access events carrying a bounded sent
count and complete/partial/failed outcome, never provider bodies or credentials.
Complete means the eligible batch was processed, not that held exports have been
reconciled. If the process dies or the grant is revoked before completion, the
summary may be absent; any pending send remains held. Revocation closes subsequent
database commands but cannot retract an HTTP request already in flight.

Verification: pgTAP covers scope denial, tenant isolation, candidate holds,
revocation and run replay; concurrent ordinary sessions prove a single dispatch.
Unit tests exercise cron authentication/sign-out, failure stopping and the time
budget. `npm run test:fortnox-automation` uses synthetic local identities to test
the owner switch, worker acceptance, last run and staff denial; external fetches
are blocked. Real scheduled voucher delivery still requires pilot evidence.

Version 1 connects one Fortnox company to one store, verifies it and keeps
the tokens sealed on the server. It sends nothing to Fortnox. Voucher sending
is a later slice and requires the database pin described below.

## Why the company is pinned

The Fortnox integration (client id and secret) belongs to the developer
account. Which company a token belongs to is decided by the person who
authorises in the Fortnox consent screen, not by the integration. The pilot
developer account also owns a production company, so a token for the wrong
company must be refused before it is stored, and the check must not rely on
the organisation number: a Fortnox test company can carry the same number as
the production company it was created from.

Two pins apply, read from the deployed configuration:

| Pin                                | When                         | Source                                |
| ---------------------------------- | ---------------------------- | ------------------------------------- |
| `FORTNOX_EXPECTED_COMPANY_NAME`    | mandatory from the first day | the company name shown in Fortnox     |
| `FORTNOX_EXPECTED_DATABASE_NUMBER` | after the first check        | `DatabaseNumber` from the first check |

A token whose company information does not match both pins (the second when
set) is dropped; only the company name, database number and the reason are
recorded as a `refused` event. The database number pin in configuration is
optional (owner decision 2026-09-14: the Fortnox consent screen makes the
company choice explicit); the stored connection is itself bound to the
database number it was made with, and every check, refresh and send is
refused when another database answers.

## Configuration

Server-only, in Vercel (Production) for the hosted pilot:

| Variable                           | Meaning                                                |
| ---------------------------------- | ------------------------------------------------------ |
| `FORTNOX_CLIENT_ID`                | integration client id from the developer portal        |
| `FORTNOX_CLIENT_SECRET`            | integration client secret                              |
| `FORTNOX_PILOT_TENANT_ID`          | the one store allowed to connect (uuid)                |
| `FORTNOX_EXPECTED_COMPANY_NAME`    | the company name pin, compared case-insensitively      |
| `FORTNOX_EXPECTED_DATABASE_NUMBER` | the database number pin, optional until first check    |
| `KOMISIO_CREDENTIAL_KEY`           | 64 hex characters; seals stored tokens and signs state |

The developer portal must list the redirect URI
`<NEXT_PUBLIC_APP_URL>/api/integrations/fortnox/callback` and the scopes
`companyinformation` and `bookkeeping`. Rotating `KOMISIO_CREDENTIAL_KEY`
makes stored tokens unreadable (`CREDENTIAL_UNREADABLE`); the owner
disconnects and connects again.

## Flow

1. Owner or admin presses "Connect Fortnox" on the accounting page. The
   server signs a state (tenant id, ten minutes) with the credential key,
   stores it in an httpOnly cookie scoped to the Fortnox routes and redirects
   to the Fortnox consent screen with `access_type=offline`.
2. Fortnox returns to the callback with a code. The state must verify and
   match the cookie; the signed-in user must still be owner or admin of the
   tenant named in the state.
3. The code is exchanged for tokens; `companyinformation` is read with the
   access token; the pins are checked. On mismatch the token is dropped and a
   refusal recorded. On match the tokens are sealed (AES-256-GCM, purpose
   bound) and stored through `store_fortnox_connection`.
4. "Check Fortnox connection" re-reads the company with the stored token
   (refreshing and re-sealing when close to expiry; Fortnox rotates refresh
   tokens) and records a `checked` event with the company identity.
5. "Disconnect" deletes the row through `disconnect_fortnox` and records the
   event.

## Database

- `fortnox_connections`: one row per tenant with database number, company
  name, organisation number (for display only), the sealed box (`iv`, `tag`,
  `data`), scope, expiry and timestamps. No grant to any role; update and
  delete are refused outside the engine (`IMMUTABLE_CONNECTION`). While a
  row exists a token for another database number is refused
  (`FORTNOX_WRONG_COMPANY`).
- `fortnox_connection_events`: append-only (`connected`, `refreshed`,
  `checked`, `refused`, `disconnected`), readable by owner or admin.
- Functions: `store_fortnox_connection`, `read_fortnox_connection` (owner or
  admin; the only path to the ciphertext), `fortnox_connection_status` (any
  member; never the ciphertext), `record_fortnox_check`, `disconnect_fortnox`.

## Voucher sending

### Confirmed-sent engine command (2026-09-15)

`confirmFortnoxVoucher` calls the owner-only `reconcile_fortnox_send` RPC with
`confirmed_sent`, the held send ID, voucher series/number, financial year and
1–500 characters of evidence. It performs no provider call. The owner must have
compared the voucher in the send's pinned Fortnox company with the immutable
export; this command records that person's assertion, not automatic verification.

Only pending or FORTNOX_OUTCOME_UNKNOWN sends qualify. The row retains its original
actor, company binding and transport error. Separate reconciliation metadata and
one append-only `fortnox.reconciled` event identify the confirming owner, voucher,
evidence and prior state. An exact same-owner replay returns the outcome; changed
coordinates or evidence are refused. A normal sent row cannot be reconciled.

The owner form on held export rows shows the send's pinned company database and
requires the voucher coordinates and evidence. Admin and staff have no form and
cannot submit the confirmation route. Compare against Fortnox directly: the
read-only provider candidate list is not implemented yet. Pending/unknown rows
no longer offer a resend button. Exact replay is safe after a lost form response.
Absence is still refused, and no reconciliation can authorize another POST. Automated
sending, dispatch leases, token renewal and confirmed-absent recovery are separate
slices. Tests use synthetic vouchers; no real voucher was reconciled here.

### Retry safety prerequisite for automation (2026-09-14)

Only a newly created send grants its caller permission to POST. A pending replay
or a lost begin response never grants another POST, even after ten minutes.
Failure before POST is recorded as FORTNOX_PREFLIGHT_FAILED and may be retried.
After POST is attempted, any error (including a failed local acknowledgement of
a successful voucher) is conservatively FORTNOX_OUTCOME_UNKNOWN: another send for
that export is refused. A committed sent row remains authoritative on replay.
Old failed sends without proven preflight refusal are also held. No historical
row is deleted or repaired by this migration.

The earlier stale-row replacement and unconditional failed-send retry described
below are superseded by this rule. This can hold a request that never reached
Fortnox; availability is deliberately secondary to avoiding duplicate vouchers.
No automated voucher reconciliation or retry-unlock command is provided. The owner
and operator must compare the immutable export and Fortnox voucher series/number,
date and lines, preserve the evidence, and escalate before any manual correction.
Never reset send rows, delete exports, or bypass the hold to make a retry succeed.

The rollout fails closed until the new begin RPC returns dispatchAllowed. Stop
new sending while application instances roll over; an old application instance
does not understand the new dispatch flag. No real voucher was sent as a test.

One recorded export (see [ACCOUNTING-EXPORT.md](ACCOUNTING-EXPORT.md)) becomes
at most one voucher in the connected company. Owner or admin presses "Send to
Fortnox" on an export row; the request carries a request id.

1. `begin_fortnox_send` opens a send row bound to the connection's database
   number. It refuses without a connection, for a store whose currency is not
   SEK (`FORTNOX_CURRENCY_UNSUPPORTED`; Fortnox vouchers are in the company
   currency), for an export already sent (`FORTNOX_ALREADY_SENT`) and while
   another send is pending (`FORTNOX_SEND_IN_PROGRESS`, ten minutes, after
   which the stale row is closed as failed). Replay by request id returns the
   recorded state.
2. The server reads the company with the stored token and refuses when the
   database number differs from the one the send is bound to.
3. `POST /3/vouchers` with series A, the close date as transaction date,
   description `Dagsavslut <date> v<version>` and the recorded lines: the
   tenant's four-digit accounts, amounts as kronor with two decimals. Komisio
   invents no accounts and no postings; the lines are exactly the export.
4. `complete_fortnox_send` closes the row as `sent` (series, number, year) or
   `failed` (allowlisted reason code). Only proven preflight failures may be
   retried as a new row; unknown outcomes remain held. Members see the send log;
   sending is owner/admin or the accepted scoped automation identity.

## Not in this slice

Account mapping changes, reading or correcting Fortnox vouchers,
stores in other currencies, more than one store per
deployment (the single pilot slot mirrors the Zettle pilot), a per-tenant
client id.

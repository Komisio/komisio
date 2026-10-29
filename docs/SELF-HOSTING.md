# Running the platform yourself

## Automatic sale-period notices

Period notices use a separate store-policy switch, `automaticPeriodNotifications`,
which defaults on when absent. The seller's automatic-email opt-out still wins.
The older `automaticSellerNotifications` switch does not control these notices.
No messages are sent until the operator configures the worker and mail transport.

Create a dedicated verified Auth identity through normal account registration.
Do not give it tenant membership or platform-host privileges. Set its server-only
`KOMISIO_PERIOD_NOTICES_EMAIL` and `KOMISIO_PERIOD_NOTICES_PASSWORD`, the existing
`CRON_SECRET`, and the seller-email transport/from/allowlist variables. Keep
staging restricted to synthetic recipients. Once transport and cron are ready,
the database operator registers the identity with
`select komisio_private.configure_period_notice_worker('<auth-user-uuid>', true);`.
This is an operator-only SQL capability, not an application RPC or service-role
client. Registration establishes the cutover timestamp; do not backdate it.

Vercel calls `/api/automation/period-notices` every ten minutes. Other hosts can
call it with `Authorization: Bearer <CRON_SECRET>` on that schedule. Each run
scans at most 4,000 items through a durable cursor and has a 180-second work
budget. `catchingUp` means another run is needed. Larger inventories or cap
pressure can delay delivery. The reminder becomes due at Stockholm midnight
seven calendar dates before the deadline; the end notice is due at the deadline
or an earlier recorded end. These notices do not end stock or remove POS products.

Activation and re-enabling exclude past due events. Extensions invalidate stale
unclaimed notices; an already claimed reminder is not repeated in the same cycle.
Reopening starts a new notice cycle without creating a fee. Shared daily mail
caps and language fallback apply. A claim freezes the exact communication and
allows one send attempt; a lost claim/send/result response never causes an
automatic resend. Staff history shows an unresolved claim as unconfirmed.

To stop new claims, the operator calls the same configuration function with
`false`. An already claimed transport call may still finish. Re-enabling or
changing the worker identity creates a new cutover. Existing claims and message
history remain intact. Check provider evidence for unknown outcomes; do not delete
claims, resend them, or backdate activation to recover an uncertain delivery.

## Mobile seller commands

`POST /api/mobile/v1/seller` is an opt-in bearer-token endpoint for the Expo
seller app. Set both `KOMISIO_INTAKE_ENABLED=true` and
`KOMISIO_MOBILE_API_ENABLED=true` only after verifying the intended release.
The API uses the configured public Supabase project key and the caller's access
token; it neither accepts browser-cookie identity nor needs a service-role key.
It validates verified email, password-recovery state, MFA and the exact seller
account before invoking the existing engine. Staff membership alone grants no
access through this endpoint. Existing browser portal routes are unchanged.

Native clients send `Authorization: Bearer <access-token>` and JSON without an
Origin header. For a web build, set `KOMISIO_MOBILE_ALLOWED_ORIGINS` to a comma-
separated list of exact HTTPS origins, with no path, trailing slash or wildcard.
HTTP is accepted only for explicitly listed loopback origins, such as
`http://127.0.0.1:8082`, for local tests. An empty setting permits native clients
only. Preflight allows POST and Authorization/Content-Type; no credentialed CORS
is enabled. Origin is an additional browser restriction, never identity proof.

The strict actions are `requestPayout` (integer `amountOre`), `saveBank`
(`expected` version and the existing bank details shape), and `acceptAgreement`
(`agreementId`, optional exact `translationId`). Each includes `tenantId`,
`sellerId` and a UUID `requestId`. Input is capped at 8 KiB of streamed UTF-8 JSON.
Payout approval/payment and staff bank review are not exposed.

Clients must persist an immutable pending command and its request ID until its
outcome is known. Retry a timeout or HTTP 503 with exactly that command; do not
create a replacement payout request or substitute newer bank/agreement data.
Safe 409 responses identify conflicts or current engine preconditions. A 200
returns `{ok:true,id}`; agreement acceptance may return existing equivalent
evidence with a different ID. HTTP 401 requires sign-in; `MFA_REQUIRED` requires
verification and `PASSWORD_UPDATE_REQUIRED` requires completing recovery.
There is no new financial rule or database grant in this transport. Code-level
checks do not establish native-client or hosted verification.

## Verified local setup

The application runs without an AI key, paid API or hosted Supabase project.
Use Node.js 24 LTS (recommended), npm, Docker Desktop/Engine and Supabase CLI
2.117.0. Windows helper scripts also find Docker Desktop in its default path.

```sh
npm ci
npm run db:start
npm run db:migrate
node scripts/configure-local.mjs
npm run dev
```

The configuration helper writes local public client settings to ignored
`.env.local`. Do not run it over an environment file containing hosted settings.
It does not need or store an application service-role credential.

- Application: http://127.0.0.1:3000
- Verification/password-reset inbox: http://127.0.0.1:54324
- Local Supabase API: http://127.0.0.1:54321
- Local Supabase Studio: http://127.0.0.1:54323

Use 127.0.0.1 consistently: cookies and allowed callbacks are origin-specific.
Register in the application and follow the local email confirmation link in the
same browser that requested it (PKCE). Invited colleagues need the matching,
verified email address. Team invitation links default to manual sharing.
Optional Resend delivery to allowlisted pilot mailboxes is implemented; see
`docs/HOSTED-STAGING.md`. Hosted delivery still needs provider configuration.

Stop the web server before building/running the production process:

```sh
npm run build
npm start
```

The production build uses Next.js standalone output. The start helper copies
static assets, loads local environment values when present and binds to 127.0.0.1
by default. Set KOMISIO_HOSTNAME explicitly if your deployment needs another
interface. These commands
run the application on the host with local Supabase containers. A packaged
application Docker image/Compose deployment has not been built or validated.
Do not describe this development installation as an external production service.

## External test deployment

The hosted staging deployment is running on Vercel and Supabase. The steps
below describe setup requirements, not a completed validation of every
self-hosted topology.

Use the same app against hosted Supabase or a complete self-hosted Supabase stack
(Auth and API included; a bare PostgreSQL database alone is insufficient).
Choose the public HTTPS application/API origins, set the three variables in
`.env.example`, apply additive migrations, and configure Supabase Auth:

- Confirm email before first access; minimum password length is ten characters.
- Register the application's `/auth/callback` and `/auth/activate` redirect URLs
  and site origin (matching `NEXT_PUBLIC_APP_URL`, without a trailing slash).
- Configure a real SMTP provider and sender, verification and recovery templates,
  delivery monitoring and production rate limits. The local email limit is
  deliberately generous for tests.
- Enable TOTP enrollment/verification if MFA is offered. The database requires
  aal2 once a verified factor exists; this is not a browser-only restriction.
- Both browser and application server must reach the public Supabase API URL.
  `NEXT_PUBLIC_*` values are embedded at build time: rebuild for another origin.

Verify registration, recovery, invitations, MFA and tenant isolation again on
the deployed origin. Put the server behind HTTPS and prevent shared-cache storage
of session responses. Restrict infrastructure credentials to the operator;
ordinary application requests use the signed-in user's session.

Seller registration with email requests a passwordless Auth account and activation
mail. Existing accounts and passwords are reused; the seller confirms the link
and can choose a password. Phone-only registration does not create an Auth account.
The existing welcome send also activates older sellers on explicit staff request;
there is no bulk backfill and no store membership is granted.

Activation inherits
enabled seller/invitation delivery and its recipient allowlist, or can be enabled
separately with `SELLER_ACCOUNT_DELIVERY=auth`. `manual` disables account creation
and mail. Keep the existing per-store communication caps. Install the confirmation
and magic-link templates generated by `scripts/confirmation-template.mjs`; hosted
main deployments install both through `configure-auth-emails.mjs`. The template's
activation URL must use the application's configured Site URL.

In SMTP compatibility mode the history retains a token-free notice. Auth renders
the secret link. A persisted claim allows one send attempt; a timeout or
interrupted request remains uncertain and is never automatically resent. Staff
may explicitly send a new activation message. A saved seller is retained even
when Auth or SMTP is unavailable. Verify cross-browser activation, existing
password preservation and delivery monitoring before enabling hosted traffic.

For store-branded activation, deploy `/api/auth/email` and the additive activation
email migration first. Set a separate random 32-byte signing key, encoded as
`v1,whsec_<base64>`, in `KOMISIO_AUTH_EMAIL_HOOK_SECRET` in the application and the
matching protected GitHub environment. Keep `KOMISIO_AUTH_EMAIL_HOOK_ENABLED`
false until setup is verified. The app also needs its existing `RESEND_API_KEY`
and `SELLER_EMAIL_FROM` (or `INVITATION_EMAIL_FROM`).

Run the **Auth email hook** workflow on main for staging, then production after
verification. It probes the deployed handler with a signed, non-sending request,
preserves redirect settings, installs the Supabase Send Email hook and verifies
readback. For self-hosting, configure the same HTTP hook and signing key in Auth.
Only then set `KOMISIO_AUTH_EMAIL_HOOK_ENABLED=true` and redeploy the application.
Use distinct keys per environment. Never use the repository's synthetic local key.

The hook replaces SMTP for **all Auth mail**, so verify ordinary signup, recovery,
secure email changes and account-security notifications too. It preserves their
verification flows; custom operator SMTP templates need review before switching.
Confirmation remains localized; other non-activation messages use English.
Branded emails render the queued subject/body, adding only the private button URL.
The capability is consumed before provider sending; uncertain attempts require
an explicit new send. Existing account metadata is never changed for branding.
To roll back, disable branded sends and redeploy first, then disable the Auth
hook to restore the retained SMTP templates. Do not remove the additive columns.

Local Auth uses a synthetic hook and Mailpit. After `npm run db:start` and
`node scripts/configure-local.mjs`, run
`node --env-file=.env.local --import tsx tests/fixtures/auth-email-server.ts`
alongside the local app. Playwright starts it automatically; CI keeps it running
for all Auth integration checks. The fixture sends only to `@example.test` and
never calls the external email provider.

## Recovery and operations before external pilot

Password reset is available through email even when the user has no store.
A lost MFA device currently requires an operator procedure; no recovery-code or
self-service factor-removal interface exists. Define identity verification,
audit and session revocation before using that procedure with real users.

Account deletion is not an application feature. Foreign keys deliberately stop
removing referenced owners, invitation creators and audit actors. Define
anonymization and retention with the real service lifecycle before adding it.

Backups must cover database data and the Supabase Auth/operator configuration.
Choose a backup frequency and recovery objective, protect backup access, and
perform a restore into an isolated environment before admitting pilot users.
No backup/restore exercise or externally hosted deployment has been verified yet.

## Optional monthly consignment fees

Owners/admins enable calendar periods under Settings → Sale period. Choose the
number of months from physical receipt, collection days, and optionally a monthly
fee per seller. Fee amounts can include or exclude a separately selected VAT
rate. Collection is either a seller-balance deduction (which may create debt) or
a separate external checkout payment. No fee or receipt period is backfilled.

Each seller's first receipt anchors billing months in Stockholm local time.
Further deliveries share the current month. Every started month is charged in
full; only accepted, active items ending after its boundary renew the next month.
Sold or collected items and collection grace alone do not renew it. A new receipt
after billing stops starts a new period. Receipt deadlines and billing terms
remain frozen when settings change; existing explicit extensions still apply.
Staff record actual collection or recycling, with recycling available after the
collection deadline. A deadline does not assert that physical disposal occurred.

The database-only `komisio-consignment-fees` job runs hourly at minute 7 when
`pg_cron` is installed. It acts as the period's policy publisher only while that
identity remains an owner/admin. Closed/read-only stores are skipped. Self-hosted
operators without pg_cron must schedule
`select komisio_private.run_automatic_consignment_fees()` using their database
scheduler; never grant this function to application roles. Staff can also catch
up a seller's fees from their Economy tab. Payout approval catches up due fees
before reserving money. Each month and reversal is idempotent under concurrent
requests; a run processes at most 120 due months per period.

The Economy tab and seller portal show fee history. Staff record separate
payments with an external receipt reference; Komisio does not process payment.
Owner/admin corrections append a full reversal, never edit the original fee.
An already paid external fee requires an external refund workflow, which is not
implemented here. Balance fees and their reversals appear separately in day
closes and require their six explicit accounting map keys before export.
Separate POS payments are excluded from this export to avoid duplicate booking.
The store currency is frozen once a fee exists.

## Automatic Fortnox scheduling

If automatic Fortnox sending is configured, schedule an authenticated request to
`/api/automation/fortnox-send` every minute with the configured `CRON_SECRET`.
Use the existing ordinary automation identity and owner-enabled `fortnox_send`
grant; never an administrator database credential. See `FORTNOX-CONNECTION.md`
for provider and worker configuration. Vercel uses the checked-in cron entry;
self-hosted operators must configure their own scheduler.

Owners choose any `HH:MM` under Accounting → Settings in Europe/Stockholm.
The default is 07:00 local, intentionally 1–2 hours earlier than the old 07:00 UTC.
The database enforces local-day claims, DST handling and same-day delayed ticks;
the scheduler's own timezone does not change the store's time. Completed days
cannot repeat, partial batches retain their cutoff, and later exports wait until
the next day. Interrupted claims and uncertain sends remain held. The setting
persists when the grant is disabled and re-enabled. This does not create exports
or change the independent day-close automation.

## Outbound event webhooks

Operators can connect shop creation to their own onboarding or notification tools.
This is **off by default**. Configure these server-only environment variables:

| Variable | Meaning |
| --- | --- |
| `KOMISIO_EVENTS_WEBHOOK_URL` | Optional HTTPS receiver. Unset means no request or background work. |
| `KOMISIO_EVENTS_WEBHOOK_SECRET` | Required when a URL is set. Use a long random shared secret. |
| `KOMISIO_EVENTS_WEBHOOK_TIMEOUT_MS` | Optional timeout in milliseconds; default `3000`, integer from `1` to `30000`. |

Invalid configuration (including a missing secret, non-HTTPS URL, embedded URL
credentials or invalid timeout) disables delivery and produces one non-personal
configuration warning per server process. Redirects are not followed.

After `/api/platform` successfully creates a new shop, Next.js `after()` schedules
one POST after the response. A retry of the same creation request does not send
another event. Existing creation permissions, membership and currency rules apply.
Database errors do not schedule events. Direct SQL/RPC creation does not dispatch
HTTP events. This is **best-effort, at-most-once**, with no retries or durable outbox:
a server interruption can lose a notification. Webhook errors never change the
successful creation response. Configure a serverless duration longer than the
chosen timeout; self-hosted Next.js also runs the callback after responding.

The JSON payload is:

```json
{
  "event": "tenant.created",
  "event_id": "10000000-0000-4000-8000-000000000001",
  "created_at": "2026-10-16T10:00:00.000Z",
  "data": {
    "tenant_id": "10000000-0000-4000-8000-000000000002",
    "shop_name": "Example shop",
    "owner_email": "owner@example.test",
    "owner_display_name": "Example owner",
    "locale": "en"
  }
}
```

`event_id` is a new UUID for the delivery; `created_at` is the UTC event timestamp.
`locale` is the request's resolved locale (`sv`, `en`, `no`, `dk`, `fi`, `de`, `es`,
`it`). Missing owner display names are empty strings. Marketing-email consent is
not inferred from signup or cookie preferences and is not included (follow-up #466).

Headers: `Content-Type: application/json`, `X-Komisio-Event: tenant.created`,
`X-Komisio-Delivery: <event_id>`, `X-Komisio-Timestamp: <Unix seconds>` and
`X-Komisio-Signature: sha256=<hex HMAC-SHA256>`.
The signed bytes are the ASCII timestamp, a dot, and the **unaltered raw body**.
Verify before parsing or processing; do not reserialize JSON. A Node.js receiver
can use this verification function (return an error response when false):

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody, timestamp, signature, secret) {
  if (!/^\d{1,12}$/.test(timestamp ?? '')) return false
  if (!/^sha256=[a-f0-9]{64}$/.test(signature ?? '')) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest()
  const supplied = Buffer.from(signature.slice(7), 'hex')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
```

Reject timestamps more than five minutes in the past **or future**, compare the
signature in constant time, validate the event schema, and check that the event
and delivery headers match the signed body. Atomically record processed delivery
IDs before side effects to reject duplicates. Return a successful status promptly;
the sender discards the response body and never retries non-2xx responses.

**Privacy:** payloads contain personal data. Use only an endpoint you control,
with suitable access restrictions and retention. Do not treat receipt of this
event as permission to send marketing email. Komisio logs neither the payload nor
receiver URL, secret, response body or exception details. Enabling the environment
variables is an operator decision; deployment alone leaves the feature disabled.

## Local verification

### Optional product-news email preference

After applying the marketing-consent migration, set
`KOMISIO_MARKETING_CONSENT_ENABLED=true` to offer an optional, unchecked signup
checkbox and a preference under Account. It is disabled by default and independent
of advertising cookies. Signup captures only explicit boolean choices with wording
version `product-news-v1`; later Auth metadata edits cannot rewrite that choice.
Existing users are not opted in. The protected register records server timestamps
and retains opt-ins and withdrawals as separate rows. Only the verified account
holder can read or change their preference; MFA requirements still apply.

When enabled, `tenant.created.data.marketing_consent` contains the owner's current
boolean preference read from this register. When disabled the field is omitted;
missing consent must never be treated as opt-in. Lookup failure skips that delivery
without failing store creation. Account holders with existing consent can still
withdraw when the feature is disabled.

This feature does not send newsletters or implement a mailing-list integration.
The creation event is a snapshot, not a subscription feed: later account changes
do not emit events. Do not use an old creation payload as ongoing permission to send;
an email integration must honor current withdrawals before any campaign. Configure
that integration and operator privacy information separately before sending mail.

### Checks

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:concurrency
npx playwright install chromium
npm run test:e2e
```

Browser tests create synthetic example.test identities and E2E-named stores in
the local database. The concurrency test creates and drops only its own uniquely
named local test database. Database tests run in rolled-back transactions.
Never target production with this test setup. Use additive `db:migrate` for
updates; resetting the database destroys local data and is not needed here.

The default local PostgREST v16.2 intermittently rejected fresh sessions.
`npm run db:start` prepares the pinned v14.18 maintenance release before starting
containers. The CLI reads `supabase/.temp/rest-version`; the source of the pin is
`supabase/local-services.json`. The official v14.18 release fixes the timing bug:
https://github.com/PostgREST/postgrest/releases/tag/v14.18

If an existing local stack is running, stop it with `node scripts/supabase.mjs
stop` (normal backup behavior), then run `npm run db:start` to apply the service
version. No database reset or JWT validation relaxation is needed. This is a
local service pin; validate the provider's deployed version separately for a
hosted environment.

## Legal document links

Set the server variable KOMISIO_LEGAL_BASE_URL to the operator's document base
URL, for example https://operator.example/legal. Pages must use
{base}/{locale}/{page}/, with locales sv, en, no, dk, fi, de, es, it and pages
terms, privacy, dpa, pricing. Danish uses dk, not da. The Komisio-hosted service
can explicitly set https://komisio.com; there is no implicit hosted default.
Unset, empty or invalid configuration hides the links, including the advertising
privacy link. Configure the advertising notice and its documents together before
enabling that optional feature. HTTP(S) URLs may contain a path, but no credentials,
query or fragment. Configuration is read on the server and the public document
base is passed to the relevant UI; it is not a secret.

Registration, store creation and settings show document links. Billing and AI
credit purchase link to pricing and terms. Links open in a new tab, preserving
form entries. Changing the registration language updates links immediately.
This navigation does not collect consent, record accepted terms versions, change
prices or supply legal wording. The operator must publish and approve its own
documents and translations; a locale URL alone does not establish translated text.

## Support contact

Set `KOMISIO_SUPPORT_EMAIL` to your operator support address and optionally
`KOMISIO_SUPPORT_URL` to your own support page. The email must be one valid
address; unset, empty or invalid values use `support@komisio.com`. The page URL
must be absolute HTTPS without credentials; invalid values hide the page link.
These are server settings, not `NEXT_PUBLIC_` variables.

Help pages and dialogs offer an email draft with store name/id, language, app
version and a redacted page reference. Dynamic record identifiers and unknown
query values are omitted; only recognized `view`/`tab` values are retained.
Opening the draft sends nothing automatically. Search runs in the browser only.
The country-blocked signup response uses the same configured support email.

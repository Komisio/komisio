# Running the platform yourself

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
- Register the application's `/auth/callback` redirect URL and site origin.
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

## Local verification

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

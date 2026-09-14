# Automation actor: scheduled work that talks to providers

Design note by Fable, 2026-09-14, in answer to Astra's checkpoint in
ASTRA-NEXT-TASKS.md: scheduled Zettle retrieval needs an actor that can both
call the provider over HTTP and write through the engine, and no such actor
exists. This note proposes one. It changes membership (a fifth role), so it
waits for the owner's decision (D1 in
[OWNER-ACTIONS-2026-09-14.md](OWNER-ACTIONS-2026-09-14.md)). Owner decision D1
(2026-09-14): approved as proposed. Slice 1 (membership side) is delivered
in migration `20260916020000`; see "Delivered" below.

## The problem

The markdown agent runs entirely in SQL, so pg_cron can run it as the
person who enabled it. Zettle retrieval and, later, automatic Fortnox
sending are different: the provider call happens in the application
(tokens, HTTP, adapters, unit tests), and the results are written through
engine functions that require a verified session (`require_identity`,
`tenant_role`). Three shortcuts are ruled out by the hard rules and the
owner's standing instructions: a service-role client, reusing a person's
session, and a JWT the server signs with the project's secret.

## Proposal

**One automation identity per deployment, membership per store, a cron
that can only knock.**

1. **Identity.** A dedicated Supabase Auth user, e-mail confirmed, MFA not
   enrolled, whose password is a server secret (`KOMISIO_AUTOMATION_EMAIL`,
   `KOMISIO_AUTOMATION_PASSWORD`). The server signs in with the ordinary
   password grant, acts, signs out. It is a normal user: RLS, grants and
   `verified_session` apply to it unchanged; it holds no privilege a member
   does not hold. The password is rotated like any other secret.
2. **Role.** A fifth tenant role, `automation`, that can only be granted to
   that identity and only by an owner, through an engine command
   `enable_automation(tenant, scope)` that records who enabled it and for
   what (`zettle_pull`, later `fortnox_send`). The role can read what the
   job needs and execute exactly the functions the scope names
   (`open_zettle_pull_window`, `record_zettle_pull_page`, the token read
   for the pilot); every other command refuses it. `disable_automation`
   removes the membership; both are access events.
3. **Trigger.** Vercel Cron (`vercel.json` `crons`) calls
   `/api/automation/zettle-pull` every ten minutes with the `CRON_SECRET`
   header that Vercel sets. The route verifies the header, signs in as the
   automation identity, lists the stores whose automation scope includes
   `zettle_pull`, runs the existing pull for each with the existing engine
   functions, and signs out. The cron knows nothing; it only knocks.
4. **Audit.** Every fact the job records carries the automation user as
   `created_by`, and the enabling owner is in the automation membership's
   access event, so the chain "who let the machine act" is always one join
   away. Runs are logged in the existing page tables; a failure stops that
   store's run and surfaces on the integrations page.
5. **Self-hosted.** Without the two secrets the route answers 404 and the
   role cannot be granted; nothing runs.

## Why not the alternatives

- **pg_cron with pg_net calling Zettle from Postgres**: the adapter logic
  would be duplicated in SQL, the API key would live in the database, and
  none of the unit tests would cover it.
- **A per-tenant automation user**: cleaner audit, but the owner would have
  to create and rotate a credential per store; per deployment is enough
  while the pilot is one store, and the role membership already scopes it
  per tenant.
- **Signed JWT from the server**: equivalent to holding the service key.

## What it gives beyond Zettle

The same actor runs automatic Fortnox voucher sending at a set time
(roadmap P3), trial-expiry e-mails (ONBOARDING-AND-PLANS.md) and any future
"do this every night" that needs a provider. Each is a scope, enabled per
store by an owner, never by default.

## Slices, once approved

1. Migration: role `automation` in the member check, `enable_automation` and
   `disable_automation`, per-function role lists updated for the Zettle pull
   functions, pgTAP: the role cannot do anything else, only an owner grants
   it, only the configured identity can hold it.
2. Route and cron: `/api/automation/zettle-pull`, `CRON_SECRET`, sign-in
   with the automation identity, run per store, unit tests with a mocked
   auth client.
3. Integrations page: a switch "Fetch receipts automatically" (owner), the
   last run and its outcome.

## Delivered (slice 1, 2026-09-14)

The Zettle worker follow-up is documented in [ZETTLE-AUTOMATION.md](ZETTLE-AUTOMATION.md).
It includes the owner switch, last-run status and Vercel cron route, with private
shared reconciliation helpers rather than broadening arbitrary public sale writes.
Deployment of code is not proof that the dedicated identity/secrets are configured
or that a real scheduled POS action has been observed.

- Role `automation` in the member check; a trigger refuses any automation
  membership change outside the engine, and `change_member` refuses the
  role as source or target.
- `automation_grants`: an owner's grant per store and scope, naming the
  identity's e-mail (passed by the server from `KOMISIO_AUTOMATION_EMAIL`).
  `enable_automation` (owner, replay by id, one active grant per scope),
  `accept_automation_grants` (the signed-in identity accepts every open grant
  addressed to its e-mail; this creates the membership; a person who is
  already a member cannot accept), `disable_automation` (owner or admin;
  removes the membership with the last grant), `automation_status` (owner or
  admin). All three changes are access events.
- `komisio_private.automation_allowed(tenant, scope)` for the functions an
  automation may call. Every existing command that lists roles refuses the
  automation role until it is added explicitly.
- `lib/engine/automation.ts`: `automationIdentity()` from configuration,
  `enableAutomation`, `disableAutomation`, `readAutomation`,
  `acceptAutomationGrants`. The members page shows the automation member as
  a badge without role actions.

## Scopes in use (2026-09-14)

| Scope          | Opens                                                                      | Built by |
| -------------- | -------------------------------------------------------------------------- | -------- |
| `zettle_pull`  | open and record Zettle pull windows for the store (Astra, PR143)           | Astra    |
| `fortnox_send` | send recorded exports as vouchers, refresh tokens of the pinned connection | Astra    |
| `weekly_brief` | read the economy summary and brief; mail it to the owners on Mondays       | Fable    |

Owner switches: `POST /api/automation-grants` (enable, disable) for any
scope, or the integration's own route. The switch is a grant; the identity
accepts it on its next cron run.

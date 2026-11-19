# Automation identities

Scheduled workers use a dedicated verified identity, explicit per-store grants
and the ordinary engine authorization boundary. Configure server-only
`KOMISIO_AUTOMATION_EMAIL`, `KOMISIO_AUTOMATION_PASSWORD` and `CRON_SECRET`.
No service-role key, borrowed staff session or application-signed JWT is used.

## Identity and grants

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

## Scopes

| Scope          | Opens                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `zettle_pull`  | open and record Zettle pull windows for the store (PR143)                                                 |
| `fortnox_send` | send recorded exports as vouchers, refresh tokens of the pinned connection                               |
| `weekly_brief` | read the economy summary and brief; mail it to the owners on Mondays                                      |
| `shopify_pull` | read the sealed Shopify connection and renew its token, record one page of paid orders per quarter hour  |

Store-owner switches: `POST /api/automation-grants` (enable, disable) for any
scope, or the integration's own route. The switch is a grant; the identity
accepts it on its next cron run.

## Browser verification

After a production build, `npm run test:zettle-automation` starts an isolated
loopback application with synthetic pilot configuration and synthetic test
identities. It exercises the real Zettle owner switch, checks the persisted grant,
accepts it as the synthetic worker through the fixture DB helper, records a
waiting outcome and verifies the displayed state. Staff have no switch and both
toggle commands return 403; owner revocation removes the worker membership.

The harness refuses a non-loopback Supabase URL or an already running application.
Provider fetches are blocked in the child server and external browser requests
are aborted. No real cron invocation, receipt import or merchant verification is
claimed. The database is not reset; synthetic fixture records remain for diagnosis,
but the test grant is disabled during cleanup. GitHub runs this after the existing
browser and assistance checks.

# Operations runbook (hosted)

What runs on its own, which secrets it needs, how to tell it is working and
what to do when it is not. Staging today; production follows the same
shape with its own project, secrets and domain
([ONBOARDING-AND-PLANS.md](ONBOARDING-AND-PLANS.md), production checklist).

## Scheduled jobs

| Job                      | Where                                      | When (UTC)                             | Acts as                                   | Needs                                                                                                                |
| ------------------------ | ------------------------------------------ | -------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Automatic markdowns      | pg_cron `komisio-automatic-markdowns`      | 03:15 daily                            | the policy's publisher                    | pg_cron enabled and the schedule statement run                                                                       |
| Plan expiry              | pg_cron `komisio-expire-plans`             | 03:45 daily                            | the person who set the deadline           | billing enabled, pg_cron                                                                                             |
| Zettle receipt retrieval | Vercel Cron `/api/automation/zettle-pull`  | every 10 min                           | automation identity, scope `zettle_pull`  | `CRON_SECRET`, `KOMISIO_AUTOMATION_*`, per-store grant, Zettle pilot settings                                        |
| Trial and grace notices  | Vercel Cron `/api/automation/plan-notices` | 06:15 daily                            | billing actor                             | `CRON_SECRET`, `KOMISIO_AUTOMATION_*`, billing actor registered, Resend settings                                     |
| Weekly brief             | Vercel Cron `/api/automation/weekly-brief` | 05:30 Mondays                          | automation identity, scope `weekly_brief` | `CRON_SECRET`, `KOMISIO_AUTOMATION_*`, per-store grant, Resend settings                                              |
| Staging migrations       | GitHub Actions `staging-migrations`        | after each merge to main               | management token                          | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, optional `VERCEL_DEPLOY_HOOK_URL`                                    |
| Shopify order retrieval  | Vercel Cron `/api/automation/shopify-pull` | every 15 min                           | automation identity, scope `shopify_pull` | `CRON_SECRET`, `KOMISIO_AUTOMATION_*`, per-store grant, Shopify pilot settings                                       |
| Production migrations    | GitHub Actions `Production database`       | when the owner dispatches and approves | management token (production)             | `production-database` environment: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, optional `VERCEL_DEPLOY_HOOK_URL` |

Daily day-close preparation runs at 06:45 UTC on
`/api/automation/day-closes`, using the ordinary automation identity and an
owner-enabled `day_close` grant. Existing Fortnox sending runs separately at
07:00 UTC on `/api/automation/fortnox-send` with its own `fortnox_send` grant.
Both require `CRON_SECRET` and the configured automation credentials.

Cron routes reject missing configuration and invalid bearer authorization;
the exact 4xx/5xx response depends on the route. Read the response and the
recorded outcome, not just whether the request reached the server. A manual
call executes the same real actions as the schedule, including messages and
provider writes where enabled. Replay protection does not make these routes
read-only health checks.

### Automatic day-close preparation

The owner enables preparation in Accounting settings. No store is enabled by
deployment. Preparation starts with the grant's activation date and considers
only completed Stockholm calendar days. Each store run checks at most 31 days,
revisits seven processed dates for late entries and records an immutable cursor
in `access_events` with action `day_close.automatic_run`. A `partial` result
means catch-up remains; it is not a provider-send outcome. The worker processes
at most 200 stores within its time budget, with oldest processed stores first.

Recorded balance-collected consignment fees and their reversals count as active
days even without sales. Separately collected fees remain under their existing
POS accounting treatment. Preparation never charges fees, creates exports or
sends vouchers. Unmapped fee entries still require the store's approved account
mapping before export.

Use the settings page's prepared-through date and Vercel's job result to check
progress. A database exception rolls back that store's batch; a lost HTTP reply
can still follow a committed batch, so inspect its audit outcome. Existing totals
are reused on a retry. Restore the worker configuration or resolve the reported
failure before rerunning. Older corrections outside the seven-day revisit window remain
visible in Accounting reconciliation and need explicit handling. A grant enabled
today normally has no completed date to report until tomorrow.

## Secrets and settings (Vercel, Production target of the staging project)

| Name                                                            | Purpose                                                         | Rotate by                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| `KOMISIO_CREDENTIAL_KEY`                                        | seals provider tokens (Fortnox)                                 | new key, then owners reconnect Fortnox             |
| `KOMISIO_AUTOMATION_EMAIL/_PASSWORD`                            | the automation identity                                         | change the Auth user's password, update the secret |
| `CRON_SECRET`                                                   | Vercel Cron authorisation                                       | new value, redeploy; Vercel sends the current one  |
| `FORTNOX_CLIENT_ID/_SECRET`                                     | the Fortnox integration                                         | developer portal, then redeploy                    |
| `FORTNOX_PILOT_TENANT_ID`, `FORTNOX_EXPECTED_COMPANY_NAME`      | pilot binding and company pin                                   | change only with the owner                         |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | billing (test keys on staging; live refused outside production) | Stripe dashboard, redeploy                         |
| `RESEND_API_KEY`, `SELLER_EMAIL_*`, `INVITATION_EMAIL_*`        | e-mail transport and pilot allowlist                            | Resend dashboard, redeploy                         |
| `ZETTLE_*`                                                      | Zettle pilot                                                    | see ZETTLE-CONNECTION.md                           |

No service-role key exists in the application anywhere.

## One-time switches (SQL editor, database owner)

```sql
select komisio_private.enable_billing('<owner auth user id>');
select komisio_private.register_billing_actor('<automation user id>');
select cron.schedule('komisio-automatic-markdowns','15 3 * * *','select komisio_private.run_automatic_markdowns()');
select cron.schedule('komisio-expire-plans','45 3 * * *','select komisio_private.expire_plans()');
```

## Health checks

- `select state, count(*) from public.tenant_plans group by 1;` for the plan
  distribution; `select * from public.plan_notices order by created_at desc
limit 20;` for the last notices; `select * from public.billing_events
order by received_at desc limit 20;` for Stripe.
- Stripe dashboard → Developers → Webhooks → the endpoint → recent
  deliveries: every event should show 200 and `"matched":true`; an
  `"unmatched"` outcome means the event named a customer or subscription
  Komisio has never seen (check the tenant id in the checkout metadata).
- Vercel → Cron Jobs shows the last run and status of each route.
- GitHub → Actions → the latest main run → `staging-migrations` step
  summary lists the versions applied.

## When something fails

- **Webhook 5xx**: Stripe retries for days; find the cause in Vercel logs
  ("Billing webhook failed" with the event id), fix, and the retry succeeds.
  Never replay by hand with a different event id.
- **Cron 503**: the automation identity cannot sign in (password rotated,
  e-mail unconfirmed, MFA enrolled by mistake). Fix the Auth user; nothing
  is lost, the next run catches up.
- **Notice or brief not received**: check `plan_notices` / `brief_sends`
  delivery: `restricted` means the address is not in the allowlist,
  `manual` means the transport switch is off, `unconfirmed` means Resend
  did not answer in time (it may still have sent).
- **Migration job failed**: read the step log; never run `migration
repair`; fix forward with a new migration.
- **Production release**: merge to main, let it sit on staging for the
  soak period (C6, one working day), then GitHub, Actions, Production
  database, Run workflow on `main`, and approve the environment. The step
  summary lists the applied versions; the deploy hook releases the
  application afterwards. See PRODUCTION-CHECKLIST.md.
- **Staging test data**: reversible state changes for a test go through
  the engine functions or, when none exists, through
  `komisio.plan_transition='engine'` in one transaction; restore afterwards
  and note it in the private log.

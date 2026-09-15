# Production checklist

The one list to work through before the first store that is not ours runs
on Komisio. It gathers what
[ONBOARDING-AND-PLANS.md](ONBOARDING-AND-PLANS.md) (production checklist),
[PILOT-GATES.md](PILOT-GATES.md) (still open),
[HOSTED-STAGING.md](HOSTED-STAGING.md) (progression) and the owner list
([OWNER-ACTIONS-2026-09-14.md](OWNER-ACTIONS-2026-09-14.md)) say, in the
order things have to happen. Code provides the path; the owner provides the
accounts, the secrets and the approvals. Nothing is copied from staging:
production starts empty and runs the same main revision.

## What the code provides (delivered 2026-09-15)

- **Environment guard.** `scripts/check-hosted-env.mjs` accepts
  `KOMISIO_ENVIRONMENT=production` only with a production shape: an own
  domain (no staging or `vercel.app` host), real invitation e-mail
  (`INVITATION_EMAIL_DELIVERY=resend` with its settings), an own
  `KOMISIO_CREDENTIAL_KEY`, `CRON_SECRET`, the automation identity, and no
  staging-only switch (`SHOPIFY_ACCEPT_TEST_ORDERS`). A production build
  fails before it deploys when any of these is missing.
- **Production migrations.** The workflow `Production database`
  (`.github/workflows/production-database.yml`) is dispatched by hand on
  main, runs in the protected `production-database` GitHub environment and
  applies the committed migrations through `scripts/migrate-hosted.mjs
production`: same dry run, apply and history verification as staging,
  refusing a divergent remote, never repairing. When the environment holds
  a `VERCEL_DEPLOY_HOOK_URL`, the application deploys after the database.
  A push can never reach production and a dispatch can never reach staging
  (`tests/unit/hosted-migrations.test.ts`).
- **Live payments only in production.** Stripe live keys are refused
  outside production (`extensions/stripe/api.ts`); staging keeps test keys.
- **Everything else is environment-neutral**: the same migrations, jobs
  and routes as staging, configured by the production project's own
  secrets.

## Owner steps, in order

| #   | Step                                                                                                                                                                                                                                                                                                                                                                 | Done when                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P1  | Supabase: create the production project in Stockholm on a plan with point-in-time recovery; enable PITR and storage object backup; enable `pg_cron`; note the project id                                                                                                                                                                                             | Project exists, PITR and backups show as enabled                                 |
| P2  | Supabase Auth: site URL `https://app.komisio.com`, redirect URLs for the app, SMTP or the built-in sender for confirmation mail, MFA (TOTP) enabled as on staging                                                                                                                                                                                                    | A test registration confirms by e-mail                                           |
| P3  | GitHub: create the `production-database` environment, restrict deployment branches to `main`, add the owner as required reviewer, store `SUPABASE_PROJECT_ID` (variable) and `SUPABASE_ACCESS_TOKEN` (secret) of a management token that can reach only the production project                                                                                       | Environment shows the reviewer rule and both values                              |
| P4  | Vercel: create the production project from the same repository, disable automatic Git deployments for `main`, create a deploy hook for `main` and store its URL as `VERCEL_DEPLOY_HOOK_URL` in the `production-database` environment; attach `app.komisio.com` (DNS at the registrar)                                                                                | Domain resolves to the Vercel project                                            |
| P5  | Vercel production settings: `KOMISIO_ENVIRONMENT=production`, `NEXT_PUBLIC_APP_URL=https://app.komisio.com`, `NEXT_PUBLIC_SUPABASE_URL` and the production publishable key, a new `KOMISIO_CREDENTIAL_KEY` (64 hex, generated, never reused from staging), `CRON_SECRET`, `KOMISIO_AUTOMATION_EMAIL` and `_PASSWORD` for a fresh Auth user in the production project | The build passes `check-hosted-env`                                              |
| P6  | Resend: verify the sending domain, then `RESEND_API_KEY`, `INVITATION_EMAIL_DELIVERY=resend`, `INVITATION_EMAIL_FROM`, `INVITATION_EMAIL_ALLOWLIST` (widen from the pilot addresses when opening up), `SELLER_EMAIL_FROM`                                                                                                                                            | A test invitation arrives from the domain                                        |
| P7  | Integrations registered for production, each with the production callback URL: Fortnox (`FORTNOX_CLIENT_ID/_SECRET`, pilot binding), Zettle (per ZETTLE-CONNECTION.md), Shopify (a second app in the Dev Dashboard or the same app with the production redirect URL; `SHOPIFY_CLIENT_ID/_SECRET`, `SHOPIFY_PILOT_TENANT_ID` once the first store exists)             | Each connection completes once on production                                     |
| P8  | Stripe: live account in the operating company's name (C5), SEK price of 199 excl. VAT (C1), invoices with VAT; `STRIPE_SECRET_KEY` (live), `STRIPE_PRICE_ID`, webhook endpoint `https://app.komisio.com/api/billing/webhook` with the five events, `STRIPE_WEBHOOK_SECRET`                                                                                           | A test checkout in live mode completes and the webhook shows 200 `matched:true`  |
| P9  | First dispatch: GitHub → Actions → Production database → Run workflow on `main`, approve the environment; read the step summary                                                                                                                                                                                                                                      | Summary lists the applied versions; the application deploys                      |
| P10 | One-time switches as database owner in the SQL editor: `enable_billing(<owner id>)`, `register_billing_actor(<automation id>)`, the two `cron.schedule` statements (runbook, "One-time switches")                                                                                                                                                                    | `select * from cron.job` lists both jobs                                         |
| P11 | Legal: terms of service, privacy notice and data processing agreement published on komisio.com (the store is controller, Komisio processor); support address and incident procedure written                                                                                                                                                                          | Links live and referenced from the app's registration page                       |
| P12 | Drills before external users: synthetic MFA recovery on production per OPERATIONS-MFA-RECOVERY.md; a restore of a production backup into a disposable project; alerts for uptime and spend in Supabase and Vercel                                                                                                                                                    | Both drills recorded in HOSTED-STAGING.md's release record with date and outcome |
| P13 | Smoke journey on production with Komisio's own test store: register, MFA, create store, receive a bag, accept an item, print a label, record a sale, request and pay a payout, close the day; then delete or keep the store                                                                                                                                          | Journey recorded; no test data left that looks like a customer                   |
| P14 | Retention policy for seller contact data written and the erasure procedure agreed (PILOT-GATES.md, still open)                                                                                                                                                                                                                                                       | Decision in DECISIONS.md                                                         |

After P13 the first external store can register. Every later release
follows the same path: merge to main, staging soak, dispatch, approve.

## What stays different between staging and production

| Setting                         | Staging                      | Production                       |
| ------------------------------- | ---------------------------- | -------------------------------- |
| `KOMISIO_ENVIRONMENT`           | `staging`                    | `production`                     |
| Stripe keys                     | test                         | live                             |
| `SHOPIFY_ACCEPT_TEST_ORDERS`    | `true` (dev shop)            | unset                            |
| Invitation e-mail               | manual or allowlisted        | Resend, verified domain          |
| Migrations                      | after every merge, automatic | dispatched and approved by owner |
| Credential key, automation user | staging's own                | production's own                 |

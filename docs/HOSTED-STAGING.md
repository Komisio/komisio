# Configuring an isolated hosted deployment

Use separate staging and production resources. Only trusted reviewed code should
receive deployment credentials. PR previews and fixture suites must not use
production data or provider accounts.

## Application and database

1. Create a Supabase project for the target environment. Review its identity and
   apply the committed additive migrations with the CLI. Never reset a hosted
   database or repair its migration history to force a deployment through.
2. Configure email confirmation, password recovery and TOTP. Set Supabase Auth's
   site URL to the application's fixed HTTPS origin and allow its exact
   `/auth/callback`. Configure a verified sender with your email provider.
3. Deploy the Next.js application using Node.js 24. Set
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `NEXT_PUBLIC_APP_URL` and `KOMISIO_ENVIRONMENT=staging` or `production` for the
   intended target. Never use a service-role/secret key as a public client key.
4. Keep server credentials in the hosting secret store. Do not set test database
   URLs on a hosted application. Rebuild after changing public variables;
   they are embedded at build time and must not be promoted across environments.
5. Enable optional services only after their configuration and authorization
   checks pass. See [SELF-HOSTING.md](SELF-HOSTING.md) and
   [OPERATIONS-RUNBOOK.md](OPERATIONS-RUNBOOK.md).

## Repository workflows

The supplied GitHub workflows name `staging-database` and `production-database`
environments. The migration jobs use `SUPABASE_PROJECT_ID` and the server-only
`SUPABASE_ACCESS_TOKEN`; an application service-role key is not required.
Fork operators must review repository/branch guards and configure their own
protected environments before enabling those workflows. Never reuse another
operator's project identifiers, management tokens or deployment hooks.

Apply and verify migrations before promoting the compatible application build.
Require the configured test and migration checks for that exact commit. A failed
or skipped check must retain the prior application. Do not force-promote a build
to bypass the checks. Keep production approval separate from staging verification.

## Verification and recovery

`node scripts/check-hosted-site.mjs https://your-staging-origin` checks public
reachability and anonymous mutation denial. It does not verify authenticated
access, database behavior, MFA, email delivery or a live provider transaction.
Complete a synthetic walkthrough of those configured features separately.
Keep fixture tests on loopback; they create identities and are not production
smoke tests. Record installation-specific evidence outside the public repository.

Roll back an application to a previously verified compatible build if necessary.
Applied migrations remain applied; an application rollback does not restore a
database. Verify backups, Storage coverage and restoration in an isolated target.
See [operational checks](PILOT-GATES.md) and
[MFA recovery](OPERATIONS-MFA-RECOVERY.md).

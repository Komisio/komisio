# Hosted staging deployment

Status (2026-09-11): deployed to https://komisio-staging.vercel.app with hosted
Supabase and Resend. Registration and invitation-email receipt have been
confirmed by the owner. Full invitation acceptance and operational recovery
remain under validation; see [platform status](PLATFORM-STATUS.md).

## Bag-receiving activation, 11 September 2026

The owner permits completed, tested functions to be activated directly in staging
while there are no external end users. The bag-receiving migration was reviewed
with a remote dry run, applied additively to the linked staging project, and its
version was verified against the local migration history. No reset or seed ran.

`KOMISIO_INTAKE_ENABLED=true` is set on the Vercel Production target of the
**staging project**. That Vercel target name does not make this a production store
service. The application was redeployed from merge commit
`cb39c5d3c0ee19b6d54be30fffca34692a79e381` after PR #13 passed its checks.

The authenticated staging walkthrough registered a clearly marked synthetic
seller and received one synthetic bag through the normal GUI. It sent no email
and made no payment. Persistence was checked after navigation/reload and the
individual label was verified without seller contact information. Physical
printing was not exercised. The test record remains visibly marked as test data.
Login/register reachability and anonymous mutation denial were also checked.
This does not resolve the older invitation-acceptance or recovery pilot items.

For future slices: verify the staging target and green revision, apply reviewed
additive migrations, activate/redeploy and exercise the changed hosted journey.
Keep financial provider transactions and production activation separately scoped.

## Selected services

- Vercel Pro, Stockholm (`arn1`); Next.js preset, Node.js 24, repository root.
- Supabase Pro, specific Stockholm region (`eu-north-1`), dedicated staging project.
- Resend for Supabase Auth SMTP and optional invitation email.

Create resources under Komisio-controlled accounts. The operating company,
billing contact and future production setup remain owner decisions. The pilot
uses the verified `komisio.com` sender domain and the staging origin above.
Do not attach unrelated employer/customer accounts. This document does not
authorize purchases beyond the owner's agreed setup.

## Configure the test deployment

1. Create an empty Supabase staging project in Stockholm. Apply the committed
   additive migrations using the CLI against this explicitly selected project.
   Review the target before applying. Never use database reset or the local
   concurrency tests against a hosted project.
2. Configure email confirmation, password recovery, minimum password length 10,
   TOTP enrollment and verification. Configure a verified sender through Resend
   SMTP in Supabase Auth; use conservative production-like email rate limits.
3. Import `Komisio/komisio` into the Komisio Vercel team. Use a fixed staging
   domain, initially the assigned project `.vercel.app` origin if necessary.
   `vercel.json` pins Stockholm and runs a configuration check before building.
4. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `NEXT_PUBLIC_APP_URL` and `KOMISIO_ENVIRONMENT=staging` in this Vercel project.
   A publishable/legacy anon key is intentional; secret/service-role keys are
   rejected by the preflight. Never set `TEST_DATABASE_URL` in Vercel.
5. Set Supabase Auth site URL to the fixed HTTPS origin and allow exactly its
   `/auth/callback`. Set the same origin as `NEXT_PUBLIC_APP_URL`; the API checks
   the browser Origin header. Public variables are embedded at build time, so
   redeploy after changing them. Do not auto-promote a build across environments.
6. Keep all preview deployments on synthetic staging data. Only trusted code
   receives staging credentials. Untrusted pull requests do not receive Resend,
   Supabase management, database or future payment credentials. Do not share
   production settings with this project. Keep a production project separate
   when that release gate is ready.

The initial deployment check intentionally rejects `KOMISIO_ENVIRONMENT=production`.
Staging readiness is not a production release. Removing that gate requires the
pilot evidence and recovery/abuse controls below, not merely changing a label.

## Invitation email

The default `INVITATION_EMAIL_DELIVERY=manual` retains shareable invitation links.
To test actual email set:

```text
INVITATION_EMAIL_DELIVERY=resend
RESEND_API_KEY=<sending-only key restricted to the verified sender domain>
INVITATION_EMAIL_FROM=Komisio <chosen-verified-sender>
INVITATION_EMAIL_ALLOWLIST=<exact comma-separated pilot mailbox addresses>
```

Keep these settings server-side. They are independent of Supabase Auth SMTP.
The pilot allowlist is mandatory; unknown recipients fall back to manual sharing.
An email is submitted only after the existing authenticated database function
has created the invitation. Its ID is the provider idempotency key. No token is
persisted in plaintext in the application database or written to application logs.
Email necessarily contains the token and recipient, which the email provider processes.

The UI distinguishes provider acceptance, manual/restricted delivery and an
unconfirmed submission. A timeout can occur after the provider accepts a message;
it does not prove that delivery failed. Manual sharing remains available without
creating another invitation. A deliberately reissued invitation revokes the old
link as before. This implementation does not persist delivery receipts or process
bounce webhooks. Do not describe API acceptance as successful inbox delivery.

Before unrestricted invitation email, add durable account/tenant send limits,
bounce/complaint handling and delivery monitoring. The current allowlist is a
pilot restriction, not a scalable rate limiter. Do not remove it for public signup
without those controls. Auth email is controlled separately in Supabase.

## Verification and release record

After the exact revision passes GitHub's Platform checks, verify basic reachability:

```sh
node scripts/check-hosted-site.mjs https://your-staging-origin
```

This checks login/register pages and anonymous mutation denial. It does not
claim database, authenticated access, MFA or email delivery verification. If
deployment protection intercepts requests, run the walkthrough in an authorized
browser; do not weaken protection to make the script green.

Complete a synthetic owner/staff walkthrough on the actual HTTPS origin:

- Register, confirm email, create two stores and switch between them.
- Invite an allowlisted mailbox; verify inbox receipt and acceptance by the
  matching verified account. Test a non-allowlisted recipient and manual sharing.
- Verify staff cannot manage members, a stale store form is rejected and one
  store cannot read another's data. Repeat MFA enrollment/login and password reset.
- Verify provider failure retains the invitation and does not falsely report
  inbox delivery; unit tests cover rejected/ambiguous submissions without email.
- Record deployment URL, Git SHA, project identifiers, service regions and test
  outcome privately. Never store credentials or real mailbox identities publicly.

Existing Playwright tests use localhost and a local inbox. Keep running them in
CI; do not redirect them to the hosted project. They create synthetic identities
and are not a safe general-purpose production test suite.

## Recovery and progression

Revert a failed application release to the last verified Vercel deployment.
Database migrations are additive and remain applied; application rollback does
not restore the database. Verify backward compatibility before each migration.
Stop the pilot if signup/confirmation, membership isolation or MFA fails.

Before admitting external pilot users, define lost-device MFA recovery and test
restoration into an isolated project. Cover both database/Auth data and operator
configuration; future Storage objects need a separate backup. Select and verify
RPO/RTO before real sales or payouts. Configure email/uptime alerts and spending
alerts; avoid hard cost stops that silently interrupt financial workflows.

The next delivery is hosted identity/team verification, followed by one complete
store workflow and its first operated integration. Free core access and a
SEK 199/month tier are the accepted product direction. Billing, quotas, payment
webhooks and domain tables are not part of this staging preparation.

# Platform preview status

Historical foundation snapshot below. For the current delivery state, see
[development handover](DEVELOPMENT-HANDOFF.md) and the
[daytime plan](DAY-PLAN-2026-09-12.md). Reception sessions, source revisions,
reviews, seller responses and protected photos are now implemented. The owner
verified hosted image display, seller approval and staff-visible response after
PR33 on 12 September. Older counts and "not implemented" statements below refer
to the foundation stage, not the current repository.

Updated 2026-09-11. The platform runs locally and in a hosted staging preview at
https://komisio-staging.vercel.app. It is not a production store service.

## Hosted evidence and current limitation

- The owner has confirmed registration/email confirmation and use of account
  and member pages in staging.
- Supabase Auth SMTP and allowlisted invitation delivery are configured through
  Resend. The owner confirmed receipt of an invitation email.
- Invitation acceptance produced an error during the walkthrough. A replacement
  invitation and an older revoked invitation existed, but the failing link has
  not been identified conclusively. Receipt of email is not proof of acceptance.
- A confirmed callback recovery defect was fixed in
  [PR #1](https://github.com/Komisio/komisio/pull/1): failed confirmation retains
  its safe invitation destination. The redirect was verified on staging.
- [PR #2](https://github.com/Komisio/komisio/pull/2) verifies replacement links,
  wrong identities and replay through the local browser/API journey.
- Staging reachability checks verify rendered login/registration forms and a
  401 response to anonymous platform writes. They do not complete the hosted
  multi-user or account-recovery walkthrough.

Keep test data in this environment. The platform gate remains open until the
outstanding hosted journey and operational checks below are completed.

## Implemented

- Original Next.js/React/TypeScript application with Supabase Auth and PostgreSQL.
- Registration, email confirmation/resend, login/logout, password recovery and
  optional TOTP MFA. Personal account settings work without a tenant membership.
- Atomic store creation, first-owner membership, store selection and profile editing.
- Owner/admin/staff/readonly role model, members list, role changes and removal.
- Email-bound, hashed, single-use, seven-day invitation links; revoke/reissue.
- Successful access-change audit events and owner/admin visibility.
- Responsive desktop/mobile navigation and Swedish/English normal UI messages.
- CI configuration, local setup helpers, contribution/agent instructions and roadmap.

Only identity/access persistence is active. There are no active consignor, item,
VAT, commission, settlement or payout tables. The old schema remains an experiment.
The platform runs without an AI account or model key; an agent/MCP write runtime
will be introduced only with a concrete domain operation and approval boundaries.

## Local evidence

- 44 pgTAP assertions pass against PostgreSQL 17 in local Supabase.
- 28 unit tests pass for platform rules, validation, return URLs, language preference, messages and
  invitation-email transport behavior.
- A real two-connection test proves concurrent owner demotions leave one owner.
- Lint, formatting, TypeScript and production build checks are run locally.
- Browser checks cover signup/confirmation, two stores, invitations, stale tenant
  forms, forbidden administration, membership removal, language/mobile views,
  password recovery before creating a store, MFA and invalid callbacks.

The initial handover passed three browser journeys against both development
and standalone servers. The current suite has seven journeys, including callback
recovery, cross-store admin/readonly roles and English onboarding continuity;
the standalone run and PR CI pass. Production build, TypeScript, lint
and formatting are also checked. The public source repository is
https://github.com/Komisio/komisio. Remote check results are available at
https://github.com/Komisio/komisio/actions; distinguish those results from the
local checks recorded here. All browser identities are synthetic example.test users.

## Environment correction

Supabase CLI 2.117.0's default PostgREST v16.2 intermittently rejected a freshly
issued JWT, even with bounded read retries. The local setup now pins the official
v14.18 maintenance release, which fixes that bug. The retry workaround was removed;
normal token verification, RLS and function authorization remain enforced.

Release: https://github.com/PostgREST/postgrest/releases/tag/v14.18

The pinned version is declared in supabase/local-services.json and prepared before
local/CI startup. Docker-based local Supabase and hosted Supabase staging are
in use; a packaged application Docker image is not yet validated.

Vercel uses its native Next.js output; standalone output is retained for local
self-host testing. See `next.config.ts` and `docs/SELF-HOSTING.md`.

## Remaining before broadening the pilot

Use the [pilot acceptance checklist](PILOT-ACCEPTANCE.md) for the owner walkthrough
and operational decisions. It is a plan for verification, not completed evidence.

1. Owner walkthrough and usability feedback. Three-user/two-store role journeys
   now pass locally and in [PR #5 CI](https://github.com/Komisio/komisio/pull/5);
   repeat the relevant scenarios in the hosted pilot.
2. Complete hosted invitation acceptance with the latest link and matching
   verified account, and verify hosted password recovery. Email transport has
   been observed; these complete journeys remain distinct acceptance checks.
3. Lost-MFA-device recovery procedure, operator identity verification and audit.
4. Account lifecycle/retention decisions, deployment configuration, monitoring,
   backup/restore exercise and clean-environment deployment verification.
5. Maintain passing remote CI for each deployed revision. The initial published
   platform passed https://github.com/Komisio/komisio/actions/runs/34531135876.

Staging includes Vercel Stockholm configuration, build-time configuration checks
and a read-only remote reachability script. Follow `docs/HOSTED-STAGING.md` for
reproduction and the remaining operational acceptance checks.

The next domain slice after the platform gate is registering a consignor and
receiving an item. Financial rules remain open until a real store flow requires
them; readable skills inform implementation but never replace database enforcement.

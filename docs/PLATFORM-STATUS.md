# Platform preview status

Updated 2026-09-10. This is a local development preview, not a deployed service.

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
- 14 unit tests pass for roles, validation, return URLs and message completeness.
- A real two-connection test proves concurrent owner demotions leave one owner.
- Lint, formatting, TypeScript and production build checks are run locally.
- Browser checks cover signup/confirmation, two stores, invitations, stale tenant
  forms, forbidden administration, membership removal, language/mobile views,
  password recovery before creating a store, MFA and invalid callbacks.

Final local handover checks passed: three browser journeys against both the
development server and the standalone production server, production build,
TypeScript, lint and formatting. The public source repository is
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
local/CI startup. Docker-based Supabase is verified; an application Docker image
or external Supabase deployment is not yet validated.

## Remaining before external pilot

1. Owner walkthrough and usability feedback, then broader three-user role journeys.
2. Real SMTP and automated invitation-email delivery; local verification/recovery
   email currently goes to the test inbox and invites are manually shared links.
3. Lost-MFA-device recovery procedure, operator identity verification and audit.
4. Account lifecycle/retention decisions, deployment configuration, monitoring,
   backup/restore exercise and clean-environment deployment verification.
5. An actual passing remote CI run on the published revision.

The next domain slice after the platform gate is registering a consignor and
receiving an item. Financial rules remain open until a real store flow requires
them; readable skills inform implementation but never replace database enforcement.

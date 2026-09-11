# Development roadmap

Updated: 2026-09-11. Sequence: **platform and usable web UI first, store operations second**.

The platform is deployed to staging, and registration plus invitation-email
receipt have been confirmed. Hosted invitation acceptance remains unresolved.
See [current platform evidence](docs/PLATFORM-STATUS.md) and the
[11 September work plan](docs/DAY-PLAN-2026-09-11.md).

The owner has requested registration, tenant creation, login, user administration and a coherent GUI before consignment logic. This roadmap supersedes the earlier instruction to build intake immediately after the database foundation. The status below distinguishes the implemented local preview from the remaining pilot and domain work.

## Current position

The local platform preview now has a Next.js application, original responsive GUI,
registration and email confirmation, login/logout, password recovery, optional TOTP
MFA, tenant creation/switching, profiles, invitation links, users/roles and an access
log. Account recovery works before the user creates a store. Source and comments
are English; the normal UI supports Swedish and English.

| Milestone | Status | Remaining boundary |
|---|---|---|
| M0 | Implemented locally and deployed to staging | Maintain passing CI and reproducible setup |
| M1 | Local journeys and hosted registration verified | Hosted recovery and broader error cases |
| M2 | Implemented and tested | Review with the owner in the GUI |
| M3 | Local journeys tested; hosted invitation email received | Resolve hosted acceptance issue and broaden multi-user pilot |
| M4 | In progress | Hosted/self-host deployment validation, recovery operations, backup/restore exercise |
| M5 | Not started | Minimal consignor/intake flow after the platform gate |
| M6 | Not started | Real workflow decisions before financial schema |

The active database contains only stores, memberships, profiles, invitations and
access events. The earlier financial schema stays in experiments. The public repository is https://github.com/Komisio/komisio. The initial platform
is committed on main. Current remote check results are available in GitHub Actions;
local checks alone are not evidence of a successful remote run.

The tenant remains one store. A user may belong to several stores; chain grouping
is a later explicit decision.

## Delivery principles

1. Every milestone ends with something a person can use and a demonstrated completion scenario.
2. Authentication, tenancy and permissions are platform services. Financial operations will have a separate domain engine. Login does not belong in the consignment engine.
3. A signed-in identity, a tenant membership, a role and an active tenant are different concepts. A supplied tenant identifier never grants access.
4. Use shared request context and permission checks. Database policies remain an independent boundary; hiding a button is not authorization.
5. Keep the platform usable without AI, MCP or integration extensions. Design the future boundaries now; build their runtime when a concrete operation needs it.
6. The old application and schema experiment supply workflow questions, not entities to reproduce.
7. New persistence is limited to the milestone's requirements. Do not design commission, VAT, settlements or payouts while implementing identity and access.
8. Preserve applied migrations. Fix the foundation through additive migrations after checking what has been applied.

## Milestones

| Milestone | User-visible outcome | Dependency |
|---|---|---|
| M0: runnable application | Open a working web application with a coherent visual foundation | Existing files |
| M1: identity | Register, verify email, log in, log out and recover access | M0 |
| M2: tenant onboarding | Create a tenant, become its owner and switch between permitted tenants | M1 |
| M3: users and roles | Invite colleagues, manage their membership and enforce role permissions | M2 |
| M4: platform pilot | Operate the platform through a complete GUI in a reproducible test deployment | M3 |
| M5: first store operation | Register a consignor and receive an item through the same domain service | M4 |
| M6: incremental business logic | Add selling, returns, settlement and integrations one validated flow at a time | M5 |

There are no calendar promises yet. Measure completed, accepted slices before estimating later business phases.

## M0: project and runnable application

Deliver:

- Establish local Git history. Select the GitHub owner, repository name and visibility before creating/publishing the remote. Inspect tracked files for secrets and preserve the ignored private working notes.
- Add the Next.js App Router application, React, strict TypeScript, a package manager/lockfile and pinned compatible dependencies. Record dependencies in the decision log and third-party inventory.
- Use the implemented Tailwind, Radix Slot and shared original components as the UI foundation, with shared design tokens and reusable form, table, navigation, alert, dialog and loading components. Record this choice when implemented.
- Separate public auth, onboarding and signed-in layouts. Establish Swedish and English message files.
- Provide a local environment example containing placeholders only, clear setup instructions and a working local Supabase/Auth environment, including a local email inbox.
- Add lint, typecheck, application tests and production build checks to CI alongside database tests. Keep test configuration reproducible; avoid an unpinned `latest` CLI.
- Refine the definition of done: documentation-only changes need document validation; UI changes need relevant UI checks; database changes need database tests. Do not require an unrelated migration for a frontend change.

Acceptance: a clean checkout can install dependencies, start the documented development environment and render the application. Desktop and mobile layouts, keyboard focus, errors and loading states are demonstrated. CI configuration is distinguished from a verified passing run.

## M1: registration and login

Deliver:

- Registration with email and password, email confirmation, resend confirmation, login, logout, forgotten password and password reset through Supabase Auth.
- Shared server authentication helpers and appropriate browser/server clients. Service credentials never reach the browser and do not power ordinary user requests.
- Safe callback/return destinations, session renewal and a clear expired-session experience.
- A minimal personal profile: display name and language preference, with an explicit identity lifecycle tied to Supabase Auth. Supabase owns passwords and authentication identities.
- A post-login resolver that distinguishes an invitation, no memberships, one membership and multiple memberships. Until M2, the empty-membership state is honest and usable.
- Rate limits and non-revealing authentication errors. Account recovery and email delivery failures must be visible and testable.

Acceptance: a new user registers, reads a local verification email, logs in, logs out and resets a password. A logged-out browser cannot open a protected page or use its API. Existing-account errors and invalid/expired callback links have tested outcomes. No tenant or financial data is fabricated to complete the demo.

## M2: tenant creation, onboarding and active context

Deliver:

- A short onboarding form for the tenant's display name and a validated unique identifier. Do not request VAT, commission, bookkeeping or payment details.
- An atomic create-tenant operation that creates the first owner and returns the tenant identity. Handle retries and duplicate identifiers without creating orphan tenants.
- A tenant picker, a clearly displayed active tenant, and tenant profile editing for permitted users.
- A server-validated active-tenant preference. Recheck membership when resolving context; handle removal of the currently selected membership.
- Explicit tenant scoping in requests and user data caches. Define cross-tab behavior: a stale form must never silently write into a different tenant after another tab switches context. Bind mutations to the tenant the user saw and reject/reload stale context.
- Shared request context such as `userId`, `tenantId`, `role` and `requestId`, with clean 401/403/404 behavior and auditable errors.
- Auth identity integrity for membership and creator references. Decide account-deletion behavior before adding foreign keys; do not cascade away a sole owner or historical attribution accidentally.

Resolved foundation issue: direct create-and-return failed under RLS. The implemented authenticated `create_tenant` operation atomically creates ownership and returns the identity. Direct table writes are revoked. Retry tests cover both duplicate requests and loss of membership after creation.

Acceptance: register user A, create tenant A, reload and remain its owner. Create tenant B or join it, switch back and forth, and demonstrate correct context. An outsider cannot select or mutate A. Repeat create requests, removed memberships and two browser tabs are covered. Test the actual API's create-and-return operation, not only bare inserts.

## M3: members, invitations and roles

Deliver:

- A members page with names, email where authorized, role and membership state; pending invitations appear separately from active members.
- Invite by email, accept with an existing or new account, revoke and issue a replacement invitation. Tokens are unpredictable, stored hashed, expiring and single use; acceptance is tied to the intended verified identity.
- Role changes, removal of membership and a deliberate ownership-transfer/add-owner flow. Every sensitive change records the real actor, tenant, target, time and outcome without logging tokens.
- A single permission catalogue reused by server operations and UI affordances, with matching database enforcement. Use named capabilities in code rather than scattered role-name comparisons.
- Concurrency protection for the last owner. Implemented parent-row serialization is verified by two independent authenticated database connections racing to demote the last owners.
- Separate tenant membership administration from global account administration. Removing a colleague from tenant A must not delete their login or access to tenant B. Tenant administrators cannot reset another person's password through a broad Auth administration endpoint.
- No general support-user impersonation or unrestricted platform-admin GUI in this milestone.

### Implemented initial role model

The owner authorized this role model for the platform implementation. It is enforced in application checks and database operations; the earlier owner-only decision is superseded by the later platform decision in DECISIONS.md.

| Capability | Owner | Admin | Staff | Readonly |
|---|---|---|---|---|
| Use permitted tenant pages | Yes | Yes | Yes | Read only |
| Edit personal profile/security | Own account | Own account | Own account | Own account |
| Edit tenant profile | Yes | Yes | No | No |
| Invite/remove staff and readonly members | Yes | Yes | No | No |
| Appoint/remove administrators | Yes | No | No | No |
| Add/transfer ownership | Yes, with safeguards | No | No | No |
| Later operational writes | Defined per operation | Defined per operation | Defined per operation | No |

The role is per tenant: the same user can own A and have read access in B. Readonly does not imply access to every sensitive field. Scope the member directory and future payout/identity data deliberately. Avoid custom roles and a user-configurable permission designer in the first release.

Acceptance: owner A invites B as staff; B accepts, logs in and sees the correct tenant. B cannot invite or promote themselves through either UI, API or direct database access. Revoked/expired invitations fail, a token cannot be accepted twice, removed members lose access on their next request, and simultaneous owner changes cannot leave zero owners. Run tests against a real PostgreSQL instance using a non-superuser API session as well as end-to-end browser tests.

## M4: complete platform GUI and pilot readiness

The GUI starts in M0 and grows throughout M1-M3. M4 completes and verifies it; it is not the first time users see screens.

Initial information architecture:

```text
Public                   Onboarding                 Signed in
Register / Verify email  Create or select tenant     Home
Login / Reset password   Accept invitation           Tenant settings
                                                    Users and invitations
                                                    My account and security
```

Use a consistent desktop side navigation, visible tenant selector, account menu, a main work area and mobile navigation. Home should show real setup progress and useful next actions. Do not populate it with invented revenue graphs or inactive inventory menus. Tables need meaningful empty/loading/error states; forms need validation, keyboard support and Swedish/English messages.

Deliver:

- Security settings, including TOTP MFA enrollment, verification and documented recovery. Define when tenant administration requires reauthentication/MFA before opening the pilot to external users.
- Tenant/user context visible throughout the UI, with no cross-tenant state left after switching or signing out.
- A reproducible test deployment plus a documented self-host path for the application and Supabase, email and callback configuration. Record environment differences explicitly.
- Tested account lifecycle and membership revocation, audit visibility for owners, safe operational logs, backups and a restore exercise for the pilot environment.
- An end-to-end demonstration with two tenants and at least three users having different roles. A clean install must work without any AI key or paid integration.

Platform completion gate: a person who did not develop Komisio can register, create a tenant, invite a colleague, administer access and recover their own login through the GUI. All relevant CI checks and the demonstration pass before consignment work becomes the priority.

## M5: first store operation and first agent integration

After the platform gate, implement `docs/first-slice.md`: register a consignor and receive an item. Reconfirm the minimal data from the store workflow. Keep commission, VAT and settlement decisions out of this slice.

Build the human flow through the domain engine first. Then expose that same small operation through a scoped MCP adapter, including identified actor, preview, approval where required, idempotent execution and audit. A machine credential is a separate actor/credential with explicit scopes, not another human tenant role. Its effective rights cannot exceed its tenant and delegated permissions. Account/owner administration stays outside the first agent scope.

Acceptance: a human and an authorized agent perform the same intake operation through the same domain service, with tenant and actor recorded. Core operation works with the MCP extension disabled. This is where the initial runtime extension/MCP contracts are proven rather than expanded speculatively.

## M6: successive business slices

Order and requirements are refined with a store user:

1. Terms, pricing and sale of one item: validate the commercial arrangement and required evidence before specifying VAT fields.
2. Customer return and resale: reconcile the sale, refund and consignor position, including a later return date.
3. Consignor balance, settlement and payout records: decide approval/reservation, correction and retention semantics.
4. First accounting export and first sales/payment integration: choose the actual provider from user needs.
5. Optional AI-assisted intake/pricing, more channels and chain features, based on demonstrated demand.

Each slice needs a user scenario, recorded business decisions, only the necessary schema, engine/UI tests and integration acceptance. The experiment is not promoted wholesale into migrations.

## Implementation work breakdown

| Work item | Scope | Exit evidence |
|---|---|---|
| P-01 | Git/application scaffold, dependency decisions, local setup, CI skeleton | Clean install, startup and production build |
| P-02 | UI shell, auth layouts, shared components, Swedish/English messages | Usable desktop/mobile screens and UI checks |
| P-03 | Auth helpers, registration, verification and login/logout | Browser journey plus API/session tests |
| P-04 | Password recovery and post-login/invite routing | Recovery journey and invalid-link tests |
| P-05 | Atomic tenant creation and identity integrity | Real DB tests including RETURNING and retry cases |
| P-06 | Tenant selection, shared request context and cross-tab behavior | Two-tenant browser and isolation tests |
| P-07 | Permission catalogue and agreed role model | Role matrix verified at API and DB boundaries |
| P-08 | Invitation lifecycle and membership UI | Existing/new-account invite journeys |
| P-09 | Role changes, revocation, ownership safeguards and audit | Negative tests and concurrent-owner test |
| P-10 | MFA/security settings, deployment/self-host verification, platform demo | M4 completion gate |

Migrations and their tests belong in the same change as the behavior that needs them. Do not create an entire future platform schema as P-01.

## Local verification snapshot

Verified on 2026-09-10 against Docker Desktop / Supabase CLI 2.117.0 and PostgreSQL
17: 44 pgTAP assertions, 14 application unit tests, a real two-connection last-owner
race, lint, TypeScript checks and production compilation. Browser verification
covers new accounts with local verification email, tenant switching, invitations,
role denial, stale tenant forms, access removal, desktop/mobile views, language
selection, password recovery and MFA. See docs/PLATFORM-STATUS.md for the final
browser outcome and remaining limitations.

All test data is synthetic. Source is published at https://github.com/Komisio/komisio.
Staging now has SMTP and invitation email. No production store service, AI model
key or financial data model has been introduced.

## Next concrete work

1. Owner walkthrough of registration, store creation, invitations and account UI.
2. Fix issues from that walkthrough and broaden the pilot to three users with
   owner/admin/readonly roles, invitation expiry/reissue and recovery edge cases.
3. Review GitHub Actions results for the published revision and maintain
   the contribution workflow as collaborators join.
4. Complete validation of the Vercel/Supabase Stockholm staging deployment and
   Resend email using docs/HOSTED-STAGING.md, decide MFA recovery
   and support identity verification, and demonstrate backup/restore.
5. Once the platform gate is accepted, define and build the minimal intake flow.

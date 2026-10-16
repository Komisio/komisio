# Architecture

Komisio is a multi-tenant consignment engine for second-hand stores. This
document explains how the system is put together and why some parts are
deliberately rigid. Receiving, saleable inventory, sales and returns, seller balances, manual payout
confirmation, accounting exports and reviewed agent proposals are implemented.
See `docs/FUNCTIONAL-ROADMAP.md` for current scope and unresolved work; code
availability does not establish hosted activation or real-store verification.

## Overview

- **Framework**: Next.js (App Router), React, TypeScript strict mode.
- **Database**: Supabase (PostgreSQL with Row Level Security), which also
  provides auth.
- **Deployment**: Vercel/Supabase staging is available. Docker self-hosting remains
  a target; local Docker-based Supabase is verified, a packaged external Docker
  deployment is not (`docs/SELF-HOSTING.md`).
- **UI languages**: Swedish, English, Norwegian, Danish, Finnish, German,
  Spanish and Italian via message files.

Five choices are fixed before any product model exists: one engine for all
writes, rules enforced in the database, staged operations for agents, a strict
extension contract and an MCP tool contract. Together they make the system
testable and safe to operate by people and agents alike.

## Implemented platform

Store catalogue deletion is an owner/admin engine operation. Under the tenant
write lock, `delete_catalogue_record` checks categories (including translated
names), item types, attribute versions and assortment groups against every item
stage, historical corrections/classifications, receptions, proposals and
structured settings. Used records return usage counts; immutable evidence is
never removed to make deletion possible. Unused store-created defaults follow
the same rule as custom records. Shared platform definitions remain protected.
Table delete triggers repeat the check, direct client deletion stays forbidden,
and successful deletion records an audit event. In Settings → Item settings,
each store-owned row has a confirmation action and explains blocked deletion.
These catalogue mutations are not currently exposed through MCP.

`app/` contains public authentication routes, onboarding and protected pages.
`lib/supabase/` handles browser/server sessions. The request proxy refreshes
cookies; server context independently validates the identity and MFA assurance.
`lib/platform/` resolves current membership, active store, named permissions,
input validation and safe error codes. It is separate from the domain
engine: identity and team administration are not consignment operations.

Authenticated mutations enter `/api/platform`, validate same-origin requests and
input, check the active tenant and call narrowly scoped database functions using
the user's session. RLS and function authorization independently enforce access.
There is no application service-role credential. Domain and staged-operation
routes use the engine boundary; agent proposals do not bypass staff review.

Optional outbound events use `lib/events/webhook.ts`. The platform create route
schedules `tenant.created` through Next.js `after()` only after a successful
first creation. `create_tenant_with_result` shares the existing creation lock to
distinguish retries without changing membership rules. Delivery is signed,
time-bounded and best-effort, with no outbox or retries; it is disabled unless
the operator configures an HTTPS endpoint and secret. See `docs/SELF-HOSTING.md`.

Staff seller registration requests account activation through the public Auth
passwordless API after the seller is saved. The capped communication queue grants
one durable send attempt. Auth creates or reuses the identity and emails a secret
link directly; staff see only a token-free notice and delivery status. Confirmation
runs in the seller's browser after an explicit click, preserving staff sessions.
Existing identity, email verification and MFA checks still govern seller access;
activation never grants tenant membership or overwrites an existing password.
Activation-created accounts track unfinished password setup in protected Auth
app metadata; OTP's generated random password does not count as a user choice.
A password change after verification clears that state. A self-only, MFA-gated
RPC returns the setup result without exposing hashes. Repeated activation of an
established account shows confirmation and a link to the seller workspace.

Branded activation uses a signed Supabase Send Email hook. A staff-authorized
claim issues a recipient-bound, single-use, five-minute capability; only its
digest is stored. The hook consumes it through a narrow anonymous RPC to read
the frozen message, then adds Auth's secret button link and delivers via Resend.
The hook is the sole Auth email transport when enabled, including confirmation,
recovery and secure email change. No administrator client or metadata mutation
is needed. Install the hook before enabling new v3 messages; SMTP/v2 remains
available for staged rollout. Historic communication bodies remain immutable
except for the owner-approved, transaction-bound contact-erasure operation.

Seller privacy review is tenant-scoped and owner/admin-only. Its engine command
blocks unsettled money, custody and pending delivery, rechecks the reviewed
snapshot under the tenant lock, and records an immutable decision before erasing
contact/profile copies and ordinary message content. Required legal/accounting
evidence remains intact, with a reason and review date. Subsequent reviews append
decisions; they do not delete retained evidence. Closed sellers cannot receive
new goods or have erased contact data restored by an old editor. Shared Auth
identities and other tenant relationships are preserved. Unstructured files,
external copies and retention expiry require separate follow-up; this workflow
does not claim complete GDPR erasure or automatic age-based cleanup.

The database contains `tenants`, `tenant_members`, `user_profiles`,
`tenant_invitations` and `access_events`, plus Supabase-managed auth identities.
Membership and creator references have foreign keys. Removing a membership does
not delete the user's login; account deletion is not exposed and references
preserve ownership and audit attribution.

Role changes serialize on the tenant row; a tenant always retains an owner.
Invitations carry a random 256-bit single-use token, store only its SHA-256 hash,
expire after seven days and bind to a verified email. Acceptance rechecks the
inviter's current authority. Existing membership is never promoted by replaying
an invitation. Only owners/admins see other members' email addresses.

The active store is a preference, never an access grant. Every resolution checks
membership; mutations include the store shown to the user and reject a stale tab
with 409. Accounts with a verified MFA factor require an aal2 session in both
application checks and database policies/functions.

Local services pin PostgREST v14.18, whose official maintenance release fixes
sporadic fresh-JWT timing rejection observed in the CLI's default v16.2.
`scripts/prepare-local.mjs` writes the version override consumed by CLI 2.117.0.
No application timing workaround, token leeway change or authentication bypass
is used. See docs/SELF-HOSTING.md before changing service versions.

The interface uses Tailwind, Radix Slot and original shared components. Localized
messages live in `messages/`. It works without an AI subscription or
model key. Audit events record successful administrative changes; failed HTTP
requests carry a request ID, but a comprehensive security-event stream is future
pilot work.

## The five layers and their boundaries

The first gated domain slice now adds `sellers` and `bag_receipts` behind
`lib/engine/intake.ts` and authenticated `/api/intake`. Bag receipt means physical
custody only. SQL functions validate role/MFA and serialize with membership
changes; direct table mutations are denied. See
`docs/SELLER-FLOW-IMPLEMENTATION.md` for activation and remaining workflow scope.
Commercial acceptance is a separate engine operation: receiving a bag or
inviting a photo proposal does not create saleable inventory. Drop-off completion
and stocktaking record observations without inventing sales or balance changes.

The staff agreement-evidence slice adds immutable `seller_agreement_versions`
`seller_agreement_translations` and `seller_agreement_evidence`. Equivalent
language texts share the canonical version; evidence pins the exact text. It distinguishes staff-recorded external evidence from
account-authenticated seller acceptance. The portal accepts the current agreement
and retains access to previously accepted text. Receiving preserves exact version/evidence references;
publication and receiving serialize with membership changes. See
`docs/SELLER-AGREEMENTS.md` for the policy, replay and deployment contract.

```
┌───────────────────────────────────────────────────────────────┐
│  UI (web, later PWA for consignors)      MCP server (agents)   │  surfaces
├───────────────────────────────────────────────────────────────┤
│                    Engine  (lib/engine)                        │  the only
│   consignors · intake · items · sales · ledger · settlements   │  write path
├───────────────────────────────────────────────────────────────┤
│         Database: schema, RLS, grants, enforcement, tests      │  the boundary
├───────────────────────────────────────────────────────────────┤
│  Extensions (extensions/): POS, web shop, marketplaces,        │  read core,
│  payout rails, AI intake, accounting export                    │  stage writes
└───────────────────────────────────────────────────────────────┘
```

1. **Engine.** All writes with financial consequence — item state, recording
   a sale, a return, ledger entries, payouts, settlements — go through one
   engine. The UI and the MCP server are two callers of the same functions;
   neither has its own write path. The [local MCP adapter](mcp/README.md)
   exposes scoped reads, previews and supported durable proposals. Authorized
   staff decide proposals through the engine; the model does not execute its
   own approval. Built-in inference and hosted connector authorization are
   separate from the local adapter.
2. **Database as boundary.** Tenant isolation, role permissions and business
   rules are enforced by PostgreSQL (RLS, grants, triggers) and proven by
   pgTAP tests against a real database. Application code that hits a
   database rule is wrong; the rule is documented in `DECISIONS.md` and its
   test shows what it guarantees.
3. **Surfaces.** The web UI serves staff and verified sellers. The seller portal
   includes own-account items and balances, agreements, photo proposals and
   store replies. Local MCP uses a configured user JWT and process-level scopes;
   these scopes do not narrow the underlying JWT. Hosted connector access has
   its own authorization boundary. A preview is never a committed operation.
4. **Extensions.** Everything beyond the core is an extension: Zettle (POS
   and certified cash register), web shop and marketplace sync, Swish/bank
   payouts, AI-assisted intake, accounting export to Accounted or Fortnox.
   Extensions read core data and store their own; they never write core
   tables directly. Where an extension must cause a core write (a POS sale),
   it uses the engine; see `docs/EXTENSIONS.md`. Owner-authorized deterministic
   synchronization of verified POS facts follows its explicit replay-safe path.
   AI-proposed writes retain their approval requirements.
5. **Domain knowledge as skills.** Swedish consignment rules, VAT cases and
   cash-register law live in `skills/` as readable knowledge for agents and
   people, and are codified only when a decision requires it.

## Direct drop-off registration

Bag inspection registers items through the shared reception engine. Staff enter
facts and a selling price; one transaction publishes the review, records custody
and accepts the item under current policy. Required agreement evidence and seller
approval remain enforced. The full intake profile also permits this bag-bound
path; standalone quick reception keeps its profile restriction.

Inspection draft storage, tools and operation kind were retired in #458. Existing
items keep identity, prices, terms and later corrections. Removed source text is
not copied elsewhere; reads use existing reference fallbacks when details are
absent. Transfers create a reception in the destination store for staff review.

## Single-garment reception

Reception sessions bind a store and seller without inventing a bag receipt.
Sources, staff reviews, access events and seller responses preserve exact versions.
Private images live in Storage; the database pins references and enforces scope.
Optional inference is bounded, tentative and separate from publication. Local MCP
reads and previews use the same contracts. See [how AI fits](docs/HOW-AI-FITS.md)
for the current file map and [reception architecture](docs/RECEPTION-ARCHITECTURE.md)
for constraints. Preparation creates neither inventory nor a payout;
subsequent commercial acceptance registers the item separately.

## Core invariants

Precise rules and exceptions belong in `DECISIONS.md` and database tests.

- An item is the consignor's property until sold; every status and price
  change carries an identified actor.
- The consignor ledger is append-only; corrections are new rows. Payout
  reservations check available funds. Later returns or fees can create a
  negative balance without rewriting a completed payment.
- A settlement statement is numbered sequentially, immutable once issued,
  corrected by credit note.
- Audit logs and documents with legal weight are never deleted.

## What Komisio does not do

- No general ledger, no VAT return, no annual accounts. Bookkeeping data is
  exported; the accounting system owns the books.
- No certified cash register. The POS provider owns that.
- No payment processing. Payout rails are integrations.

## Tenancy

The tenant is the single store: the unit of data isolation. Users belong to
tenants through `tenant_members` with a role; membership is the source of staff
access, and a user may be a member of many tenants. Exact seller reviews use a
separate verified-email/MFA/capability boundary without granting membership.
A chain is an optional grouping above stores. It does not merge tenant data
or grant blanket membership. Cross-store reads and transfers apply explicit
authorization checks; unresolved sharing rules remain in `docs/open-questions.md`.

## Repository map (target)

```
app/            Next.js routes (UI)
lib/engine/     the engine: one module per aggregate, all writes
lib/assistance/ optional model configuration, prompts and inference adapters
lib/media/      bounded image decoding and minimization
lib/platform/   current request context, permissions and validation
lib/supabase/   implemented browser/server clients
extensions/     one folder per extension, each with manifest.json
mcp/            local scoped reads, previews and durable proposals
supabase/       migrations, tests (pgTAP), seed
skills/         domain knowledge
docs/           architecture notes, contracts
experiments/    explorations that are not decisions
```

# Komisio

Open-source consignment software for second-hand stores: consignors, intake,
items, sales, commission, settlements and payouts. Built to be operated by
people **or by AI agents**, with the rules that protect consignors' money
enforced in the database and proven by tests.

Komisio does not do bookkeeping. It produces bookkeeping data and hands it to an
accounting system through an extension.

- License: AGPL-3.0-or-later (`LICENSE`), with an exception for extensions that
  use only the documented extension API (`NOTICE`).
- Language: code, comments, commits and documentation in English; the user
  interface in Swedish and English; Swedish legal terms kept where precision
  requires it (`CONTRIBUTING.md`).

## Status: platform preview

The application now implements email registration/confirmation, login/logout,
password recovery, optional TOTP MFA, store creation/switching, user profiles,
email-bound invitation links, membership/role administration and an access log.
It has an original responsive web UI in Swedish and English. Invitations are
shared by link by default; optional Resend delivery for allowlisted pilot
mailboxes is available. See [hosted staging setup](docs/HOSTED-STAGING.md).

The foundation below has been extended to support these platform flows.

Phase 0 establishes the project, not the product:

| Area | Deliverable | Where |
|---|---|---|
| Project and open source | repository layout, license, contribution rules, CI | this file, `CONTRIBUTING.md`, `DCO`, `.github/workflows` |
| Decisions | one line per non-obvious choice, with its reason | `DECISIONS.md` |
| Technical foundation | a small runnable project: local database, additive migrations, automated tests, CI configuration | `supabase/` |
| Core and extensions | boundaries between engine, storage, UI, AI/MCP and integrations | `ARCHITECTURE.md`, `docs/EXTENSIONS.md` |
| AI working practices | agent instructions, change and verification rules, approval principles | `CLAUDE.md`, `AGENTS.md` |
| Domain understanding | concrete use cases and open questions, before the data model | `docs/open-questions.md`, `docs/first-slice.md`, `skills/` |

The active schema covers identity and access only: stores, membership, profiles,
invitations and access events. The earlier financial schema remains an
experiment: `experiments/2026-09-schema-sketch/`.

## Running

Requires Node.js (24 LTS recommended), npm, Supabase CLI 2.117.0 and Docker.
On Windows the helper scripts also find Docker Desktop's default installation.
The startup helper pins PostgREST v14.18 to avoid a fresh-session timing bug in
the CLI's default image; see `docs/SELF-HOSTING.md`.

```bash
npm ci
npm run db:start
npm run db:migrate
node scripts/configure-local.mjs
npm run dev
```

Open `http://127.0.0.1:3000`. Register your account and confirm the email in
the local test inbox at `http://127.0.0.1:54324`. The setup helper writes only
the public client key to ignored `.env.local`; there is no application service
role key. The local configuration enables email confirmation and TOTP.

The checked-in local email limit is for development, not a production policy.
Do not reset an existing database to apply changes; use `npm run db:migrate`.

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run test:db`, `npm run test:concurrency` and `npm run test:e2e`.
Browser tests use synthetic `example.test` accounts and create E2E-labelled
stores in the local database. They must not target a production environment.

## Repository map

```
ARCHITECTURE.md      how the system is put together and why parts are rigid
DECISIONS.md         decision log, one line per decision with its reason
CLAUDE.md            rules for AI agents working in this repo (source of truth)
AGENTS.md            entry point for agents that do not read CLAUDE.md
CONTRIBUTING.md      how to contribute; language, commits, DCO, tests
SECURITY.md          reporting and access principles
NOTICE               copyright, license exception, third-party notices
docs/                extensions contract, self-hosting, open questions,
                     the first vertical slice
skills/              domain knowledge for agents and humans (Swedish consignment rules)
supabase/            migrations and pgTAP tests — the runnable foundation
app/                 auth, onboarding and signed-in web routes
components/          shared UI and platform forms
lib/platform/        request context, permissions, validation and types
lib/supabase/        browser/server session clients
messages/            Swedish and English UI text
tests/               unit and browser tests
ROADMAP.md           delivery milestones and acceptance scenarios
experiments/         explorations that are not decisions
```

Verification and limitations: `docs/PLATFORM-STATUS.md`.

## Next

Complete and review the platform preview before starting store operations.
`ROADMAP.md` defines the remaining pilot/deployment work and acceptance gates.
The project repository is https://github.com/Komisio/komisio. The original
application repositories remain separate; they supply workflow questions only.
A public source repository does not mean a production service is available.

The first consignment slice, *register a consignor and receive an item*, follows
the platform completion gate. See `docs/first-slice.md`. No financial data model
until the relevant questions in `docs/open-questions.md` are answered.

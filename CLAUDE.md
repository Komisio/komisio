# CLAUDE.md: Komisio

Open-source consignment engine for second-hand stores (Sweden first, Nordics
next): consignors hand in items, the store sells them against a commission,
and pays out the consignor's share. Multi-tenant: users belong to tenants
through `tenant_members`.

**Stack**: Next.js (App Router), React, TypeScript strict, Supabase (Postgres +
RLS + auth). Hosted is the primary target; Docker self-hosting must keep
working. All code, comments, commits and docs in English.

This file is the source of truth for every agent. `AGENTS.md` links here and
must not duplicate it.

---

## Hard rules

1. **All writes with financial consequence go through the engine**
   (`lib/engine/`). Never insert into or update core tables directly from UI,
   MCP tools or extensions. If the engine lacks an operation, add it there.
2. **Rule before code, test before done.** A business rule is a line in
   `DECISIONS.md` and a pgTAP test before it is a trigger, a policy or a
   function. A change that makes a test fail is wrong until the decision log
   says otherwise.
3. **Never weaken access control to make something work.** RLS, grants and
   membership checks are the boundary. Session flags and application checks
   are not. If a task seems to require bypassing them, stop and ask.
4. **Corrections are new rows.** Nothing with financial or legal weight
   (ledger entries, settlements, audit events, documents behind them) is
   edited or deleted in place.
5. **Every non-human write carries an identified actor and is staged.**
   Agent and extension writes go through pending operations with a risk
   level; execution requires approval unless the scope allows auto-execution.
6. **Money is `numeric`, rounded to öre in the database.** Never float, never
   string arithmetic.
7. **Swedish domain questions go through `skills/`, never training data.**
   If the skill does not answer, record the question in
   `docs/open-questions.md` and ask; do not guess VAT, commission or
   cash-register rules.

General prohibitions: no new dependencies without a `DECISIONS.md` line; no
edits to applied migrations (add a new one); no secrets in the repo; no
copying source code from other projects (see `NOTICE`); keep diffs scoped to
the task.

## When uncertain

Stop and ask. Specifically: any change to tenancy or membership; any new core
table; any rule about commission, VAT, returns, payouts or settlements that is
still listed in `docs/open-questions.md`.

## Definition of done

1. The decision (if any) is in `DECISIONS.md`.
2. Relevant checks pass locally: lint/typecheck/build for application changes,
   unit/browser tests for changed flows, migration plus pgTAP for database
   changes, and a multi-connection test for concurrency invariants. Documentation
   changes do not require an unrelated migration.
3. CI is green when a remote is configured. Until then, report the local checks
   and explicitly state that GitHub CI has not run.
4. `docs/open-questions.md` updated if a question was answered or raised.
5. The final message states exactly what was verified and what is not live.

## Commands

```bash
npm run db:start       # local Supabase
npm run db:migrate     # additive migrations, preserves local data
npm run dev           # local web application
npm run test:db        # pgTAP
npm run test:e2e       # real browser journeys
```

## Repository map

See `README.md` (current) and `ARCHITECTURE.md` (target). Decisions:
`DECISIONS.md`. Domain knowledge: `skills/`.

# AGENTS.md: Komisio

Open-source consignment engine for second-hand stores. Multi-tenant: users
belong to tenants through `tenant_members`.

This file is the entry point for agents that do not read `CLAUDE.md` on their
own. It deliberately does not duplicate the project rules: `CLAUDE.md` at the
repository root is the source of truth and wins whenever the two disagree.
(A duplicated `AGENTS.md` drifts from its `CLAUDE.md` within weeks; we do not
maintain two copies.)

Read `CLAUDE.md` first, in particular:

- **Hard rules** — engine-only writes, rule-before-code, no weakening of
  access control, corrections as new rows, staged writes for agents, öre
  arithmetic, domain questions through `skills/`.
- **When uncertain** — what always requires asking.
- **Definition of done** — decision logged, migration + test, CI green,
  open questions updated, final message states what is verified.

Then: `ARCHITECTURE.md` for the layer boundaries, `DECISIONS.md` before
touching anything that was decided, `docs/open-questions.md` before touching
anything that was not.

## Issue workflow (Astra)

Work is specified in GitHub Issues, written and labelled by Kurre (the owner's
assistant) or the owner. `CLAUDE.md` still governs *how* to implement; this
section governs *which* work to take and how to deliver it.

**Picking work**
- Only pick open issues that are labelled `status:ready`, are **not** labelled
  `external`, and have no assignee.
- Order: lowest `prio:N` first (`prio:1` before `prio:2` before `prio:3`;
  no prio label sorts last), then oldest issue first.
- On pickup: assign yourself, add `status:in-progress`, remove `status:ready`.
  Take one issue at a time.

**Delivering**
- One branch and one PR per issue (`<type>/<issue-number>-<short-slug>`).
- PR body contains `Closes #N` and a checklist mirroring the issue's
  acceptance criteria, each item ticked only when verified.
- Before merging, run the repository checks locally and make sure all pass:
  `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`,
  `npm run build`; plus `npm run test:db` for database changes and
  `npm run test:e2e` for changed user flows (see Definition of done in
  `CLAUDE.md`). PR status checks must also be green.
- Self-merge only when every check is green and every acceptance criterion is
  met. Otherwise leave the PR open and explain what is missing.

**When unclear or blocked**
- Comment on the issue with the exact question (one concrete question, options
  if possible), set `status:blocked`, remove `status:in-progress`, and move on
  to the next ready issue. Do not guess.

**Never**
- Touch issues or PRs labelled `external` or opened by anyone other than the
  owner or Kurre (no comments, labels, commits, merges, reviews). The owner
  reviews external contributions; see Repository merge policy in `CLAUDE.md`.
- Change `CODEOWNERS`, branch protection/rulesets, or this file without an
  issue explicitly asking for it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

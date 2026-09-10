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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

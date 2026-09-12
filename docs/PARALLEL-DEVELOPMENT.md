# Parallel development and model handover

Read CLAUDE.md, DEVELOPMENT-HANDOFF.md, DAY-PLAN-2026-09-12.md,
HOW-AI-FITS.md and the relevant operation contract before coding. Old Komisio
supplies workflow questions, not a schema or source-code template. Use the
boundaries documented in ARCHITECTURE.md as the project's design contract.

## Replacement versus parallel work

A replacement first checks the active branch, dirty files, open PRs and the private
operational checkpoint. Preserve incomplete work and resume the recorded next
step. Do not recreate already merged migrations or replay seller decisions.

For parallel work, use a separate Git worktree from a verified main commit. Agree
one bounded file/feature scope before editing. Separate worktrees still share the
same local Supabase database and ports: coordinate browser tests, migrations and
app servers, or configure fully isolated services. Never run a database reset.
Do not copy secret environment files into a PR or commit local credentials.

## Current owner-authorized assignments (2026-09-12)

The owner explicitly assigned T3 to Claude Fable. This supersedes the earlier
suggestion to limit a first contribution to design review without a write table.
The T3 implementation stages agent proposals for staff decisions through the
shared engine, including pending-operation persistence. Its existence is
authorized; correctness and release still require review and tests.

The observed branch is `fable/review-2026-09-12`: T3 at `a86870e`, seller-read
lock changes at `cfcf303`, and T5 prompt-version protection at `aabdb13`.
These are branch checkpoints, not claims of applied migrations or green CI.
The working directory also reported modifications when inspected; leave it
untouched and obtain the final committed handover before integrating further work.

Fable owns its implementation branch. Astra owns integration review, coordinating
local migration/MCP/concurrency verification, and the release PR/CI/staging path
after a stable handover. Do not implement a competing pending-operation subsystem.
T5 already has a commit; inspect its tests and scope before treating it as new work.

Coordinate shared files such as DECISIONS.md, dictionaries, package manifests,
migrations and handover notes. One release owner merges changes after exact-head
CI and verifies staging; concurrent contributors do not deploy over one another.
Follow existing signed-off commit and PR rules. Report what is implemented,
locally tested, merged, deployed and still unverified as separate facts.

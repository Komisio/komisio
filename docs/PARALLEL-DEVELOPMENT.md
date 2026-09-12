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

Claude Fable 5.1 is lead architect. FUNCTIONAL-ROADMAP.md is the evolving
owner-selected baseline; read its current version before choosing the next slice.
Astra owns implementation verification and integration within that direction.
All 100-hours functionality is excluded from version 1. Existing T3/T5 delivery
and the current worktree status below remain implementation evidence, not a
competing architecture roadmap.

The owner explicitly assigned T3 to Claude Fable. This supersedes the earlier
suggestion to limit a first contribution to design review without a write table.
The T3 implementation stages agent proposals for staff decisions through the
shared engine, including pending-operation persistence. Its existence is
authorized; correctness and release still require review and tests.

Fable's fixed snapshot `f734f95` was integrated in PR43, merged and deployed.
T3, seller-read lock changes and T5 passed integrated CI. Both new migrations
are applied locally and in staging and must not be edited. Subsequent commits on
`fable/review-2026-09-12` are separate work; inspect them before integration.
Leave Fable's active worktree untouched.

Fable owns its implementation branch. Astra owns integration review, coordinating
local migration/MCP/concurrency verification, and the release PR/CI/staging path.
Do not implement a competing pending-operation subsystem or repeat T5.
Exact source/terms context is delivered in PR44; Fable's fixed4593bd0 roadmap was
reviewed and integrated in PR45. PR46-PR48 subsequently delivered shared
inspection reads, bag discovery and unsaved inspection previews. Astra's current
unreleased branch, `feat/staged-inspection-edits`, extends the existing T3
mechanism with descriptive inspection edits; it does not create a competing
write table or a commercial rule. See STAGED-INSPECTION.md and the private
operational checkpoint for incomplete work and test evidence.

Coordinate shared files such as DECISIONS.md, dictionaries, package manifests,
migrations and handover notes. One release owner merges changes after exact-head
CI and verifies staging; concurrent contributors do not deploy over one another.
Follow existing signed-off commit and PR rules. Report what is implemented,
locally tested, merged, deployed and still unverified as separate facts.

# Parallel development and model handover

Read CLAUDE.md, DEVELOPMENT-HANDOFF.md, DAY-PLAN-2026-09-12.md,
HOW-AI-FITS.md and the relevant operation contract before coding. Old Komisio
supplies workflow questions, not a schema or source-code template. Accounted is
an architectural reference, not a claim of parity or permission to copy code.

## Replacement versus parallel work

A replacement first checks the active branch, dirty files, open PRs and the private
operational checkpoint. Preserve incomplete work and resume the recorded next
step. Do not recreate already merged migrations or replay seller decisions.

For parallel work, use a separate Git worktree from a verified main commit. Agree
one bounded file/feature scope before editing. Separate worktrees still share the
same local Supabase database and ports: coordinate browser tests, migrations and
app servers, or configure fully isolated services. Never run a database reset.
Do not copy secret environment files into a PR or commit local credentials.

## Suggested independent first contribution

Review the current engine/UI/MCP boundaries and propose an external-preview
handoff contract in a separate document. Cover exact tenant/session/source
binding, untrusted metadata, stale previews, staff review, replay and explicit
persistence. Keep it a design review until the contract is accepted and tested.
Do not add a new agent-write table or silently import/publish a proposal.
This is a suggested task, not an assignment to an already running model.

Coordinate shared files such as DECISIONS.md, dictionaries, package manifests,
migrations and handover notes. One release owner merges changes after exact-head
CI and verifies staging; concurrent contributors do not deploy over one another.
Follow existing signed-off commit and PR rules. Report what is implemented,
locally tested, merged, deployed and still unverified as separate facts.

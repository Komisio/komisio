# Development handover

Updated 2026-09-12. Read CLAUDE.md first, then this file and the
[active day plan](DAY-PLAN-2026-09-12.md). Git, CI and deployment records take
precedence over narrative. This file supersedes older slice status notes.

## Current work

Integration checkpoint: branch `integration/fable-staged-operations` combines
main54765ec with fixed Fable commitf734f95c723e338da9c11f7d7158410c430ddd85.
Fable's live worktree remains untouched. Local lint/typecheck/build,99 unit tests,
72 new SQL assertions in a disposable database, and all owner/concurrency races
passed. The disposable SQL harness uses minimal Auth/Storage contracts; it does
not substitute for real HTTP MCP/Storage/browser tests, which run in isolated CI.
Added an operator browser case for approve/reject through the web route. T5's
historical-text scan was removed: the existing AI HTTP fixture exercises actual
runtime prompt-version acceptance by the installed database function.

No migration has been applied to shared local Supabase or staging by this
integration. Required migrations are20260912140000 and20260912150000. Before
release, require exact-head CI, inspect pending migrations and verify the staging
project; apply only those reviewed migrations and verify deployment separately.

Coordination update: the owner explicitly authorized Fable's T3 implementation.
See PARALLEL-DEVELOPMENT.md for current responsibilities and observed commits.
Do not start a competing pending-operation design. Fable's T3, seller-read lock
change and T5 prompt guard need integrated verification before release. They are
not in main at this checkpoint. Do not mutate the active Fable worktree or apply
its migrations to the shared database without coordinating a stable handover.

The prior PR40 work below is completed: merged6329b6ec95df1af3db8534921966f274f82f9e95,
exact-head CI34687228721 passed, staging deployment6408441889 succeeded.
PR41 merge3a88a228d5027ca6324bdea327360809d1f107f4 added the merge policy;
ruleset23035301 actively requires PR and platform checks with no bypass actors.

## Completed history slice

PR40, branch `feat/reception-history`: read-only reception history shared by the
staff UI and local MCP. Source and review lists have separate bounded cursors.
Old seller responses stay attached to their exact proposal version. No new table,
migration, commercial transition, contact lookup or image access.
[Contract and limitations](RECEPTION-HISTORY.md).

Local checks passed: lint/typecheck/build,94 unit tests, real MCP stdio with22
source revisions (pagination and invalid cursor/identity/tenant/MFA denial), and
seller browser journey1/1 (old approval, newer decline and review pagination).
Changed-file formatting passed. The full local Windows format check flags
unchanged CRLF files; Linux CI remains the release gate. No database reset needed.

PR40 is merged and deployed as recorded above; do not repeat its release.

## Verified recent deliveries

| Delivery | Evidence |
| --- | --- |
| Shared queue next-step guidance, PR39 | Exact-head CI34686842356 passed on dddb2098af52dda6d5fc6c5aafbb7575fe52f315. Merged as9cd6c5d810e45f680d2dd60ab2a615f767f5987d; deployment6408356330 succeeded. Public login/register and anonymous-mutation denial verified. No migration. |
| Queue pilot regressions, PR38 | Merged as5f910f533819f53a2a34b27b5928626b86c8f01b; deployment6407662441 succeeded. Expired-link historical approval and actual browser filters tested. |
| Queue and MCP read, PR36/37 | Merged and deployed through1c12df7487cc00f778a60232b69adab43c0bddc2. Migration20260912073000 applied locally AND in staging; never edit it. |
| Seller photo fix, PR33 | Migration20260912060000 applied locally AND in staging. Owner confirmed displayed image, seller approval button and saved response in staff view. |

A fresh hosted staff navigation later redirected to login. Cached UI was not
accepted as evidence of an active session. Authenticated hosted walkthrough is
still pending; this only blocks hosted verification, not independent development.
Do not impersonate the owner or change their existing seller responses.

## Next three actions

1. Obtain a stable committed Fable handover and review T3 plus its tests, keeping
   the current main merge policy when integrating the branch.
2. Coordinate migration verification and real MCP/concurrency/browser tests;
   record which database was used. No shared database reset.
3. Open the implementation PR, require exact-head green CI, apply reviewed staging
   migrations and verify deployment. Document remaining hosted-only checks.

## Architecture and remaining gates

- Core and database own identity, tenant isolation, exact versions and immutable
  decisions. UI/MCP are adapters; skills provide guidance, not authorization.
- Historical approval is not current approval, physical custody, commercial
  acceptance, POS publication or a payable balance. No generic completion flag.
- Commercial acceptance still requires item-bound terms decisions in
  [open questions](open-questions.md). Continue independent work while unresolved.
- Built-in AI provider remains optional and unverified live. No borrowed tokens,
  paid provider activation or live POS writes are authorized by this day plan.
- Main's local MCP reads/images/previews only. T3 pending operations exist on
  Fable's branch and await integration; hosted delegated login is still separate.
- Bag receiving and single-garment reception are distinct workflows.
- History is a summary, not complete historic agreement/image access or a legal
  audit. See RECEPTION-HISTORY.md before extending it.
- Invitation acceptance, account recovery, retention and backup/restore need
  their own verification before external pilot use.

## Another model or parallel contributor

A replacement can continue the current branch after inspecting status and PRs.
A parallel contributor must use a separate worktree and a clearly bounded task;
never switch branches or edit files in the other model's working directory.
Read [parallel development guide](PARALLEL-DEVELOPMENT.md). Fable is working under
the owner's explicit T3 assignment, not an automatically spawned worker.

## Operations

Repository: C:\Workspace\Inority\komisio, public remote Komisio/komisio.
Use the personal GitHub configuration recorded in ignored
private/staging-handoff.md, never Valmet identity. Use PowerShell login:false.
Local Supabase normally runs on54321/54322. Inspect running processes before
starting an app; do not reset the database to make a test pass.

Before tests/merge, append a private checkpoint with branch, full SHA, PR, exact
checks, migrations, deployment and next action. Never store secrets in that log.
Use signed-off commits and green exact-head CI. The owner's daytime authorization
covers staging releases; hosted user-only verification must be labeled separately.
The day plan ends at18:00 Europe/Stockholm unless the owner changes it. Maximize
useful progress within scope; do not pause development to conserve weekly quota.

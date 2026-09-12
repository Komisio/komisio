# Development handover

Updated 2026-09-12. Read CLAUDE.md first, then this file and the
[active day plan](DAY-PLAN-2026-09-12.md). Git, CI and deployment records take
precedence over narrative. This file supersedes older slice status notes.

## Current work

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

GitHub CI for PR40 is pending. Re-read its full head SHA and checks before merge.
Do not claim this history slice is live until its merge deployment succeeds.
The branch was based on PR39; PR39 has now merged, and PR40 targets main.

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

1. Verify PR40 exact-head CI; resolve any failure, then merge and confirm the
   matching staging deployment. No migration is needed.
2. Update this checkpoint with the merge/deployment evidence. Test the hosted
   history/queue when a fresh authorized staff session becomes available.
3. Continue a bounded independent slice: specify safe import of an external AI
   preview into staff review, or improve exact historical evidence navigation.
   Start with the operation contract; never silently save or publish model output.

## Architecture and remaining gates

- Core and database own identity, tenant isolation, exact versions and immutable
  decisions. UI/MCP are adapters; skills provide guidance, not authorization.
- Historical approval is not current approval, physical custody, commercial
  acceptance, POS publication or a payable balance. No generic completion flag.
- Commercial acceptance still requires item-bound terms decisions in
  [open questions](open-questions.md). Continue independent work while unresolved.
- Built-in AI provider remains optional and unverified live. No borrowed tokens,
  paid provider activation or live POS writes are authorized by this day plan.
- Local MCP reads/images/previews only; no durable pending-operation runtime,
  hosted delegated login or automatic GUI import of external previews exists.
- Bag receiving and single-garment reception are distinct workflows.
- History is a summary, not complete historic agreement/image access or a legal
  audit. See RECEPTION-HISTORY.md before extending it.
- Invitation acceptance, account recovery, retention and backup/restore need
  their own verification before external pilot use.

## Another model or parallel contributor

A replacement can continue the current branch after inspecting status and PRs.
A parallel contributor must use a separate worktree and a clearly bounded task;
never switch branches or edit files in the other model's working directory.
Read [parallel development guide](PARALLEL-DEVELOPMENT.md). No Fable worker has
been started or assigned automatically.

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

# Development handover

Updated 2026-09-12. Read CLAUDE.md first, then this file and the
[active day plan](DAY-PLAN-2026-09-12.md). Git, CI and deployment records take
precedence over narrative. This file supersedes older slice status notes.

## Current work

PR43 is merged as43d26f0b75f69b3e932b67561ab6c613184285ff. Exact-head
CI34689526103 passed on d4804033a90a41b5a10e62364104c15aa13d109c.
Staging deployment6408849436 succeeded. Migrations20260912140000 and
20260912150000 are applied BOTH locally and in staging; never edit them.
T3 staged proposals, seller-read isolation and T5 prompt pin are delivered.
Real local MCP and operator approve/reject browser journey passed, as did CI
including database, concurrency, Storage and AI HTTP fixture checks. Hosted
anonymous guards passed; an authenticated hosted decision remains unverified.
Fable's fixed f734f95 snapshot was integrated; its active worktree is untouched.

Current slice: `feat/operation-review-context` adds a shared exact proposal-context
read, a staff detail page and a read-only MCP tool. No new migration. Queue actions
lead to the detail before deciding. Stale/expired proposals cannot be approved in
this UI but can be rejected; SQL remains the transactional authority. Local lint,
typecheck/build,99 units, real MCP and operator browser (1/1) pass. The browser
asserts exact terms, approval, then stale approval denial and successful rejection.
PR/CI and deployment remain pending. See OPERATION-REVIEW.md.

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

1. Verify exact proposal context through real MCP and staff browser tests, including
   stale proposals, tenant/identity/MFA denial and photo-path omission.
2. Review, commit and open the scoped PR; require exact-head green CI before merge.
3. Verify the matching staging deployment and save remaining pilot checks. Inspect
   Fable's latest committed work before selecting another overlapping scope.

## Architecture and remaining gates

- Core and database own identity, tenant isolation, exact versions and immutable
  decisions. UI/MCP are adapters; skills provide guidance, not authorization.
- Historical approval is not current approval, physical custody, commercial
  acceptance, POS publication or a payable balance. No generic completion flag.
- Commercial acceptance still requires item-bound terms decisions in
  [open questions](open-questions.md). Continue independent work while unresolved.
- Built-in AI provider remains optional and unverified live. No borrowed tokens,
  paid provider activation or live POS writes are authorized by this day plan.
- Local MCP supports reads/images/previews and opt-in staged proposals. Staff
  approval executes through the engine. Hosted delegated login is still separate.
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

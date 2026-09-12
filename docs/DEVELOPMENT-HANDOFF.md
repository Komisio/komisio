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

PR44 is delivered: merge d01a23b1e8399e3cd500ee26060412c5e798bb07;
CI34690891690 passed exact head4b4affbf2c64d1b9a6db2cf05d0a1c3d40f444ac;
staging deployment6409115564 succeeded. Exact source and agreement context now
precedes staff approval and shares a read with MCP. Local lint/format/types/build,
99 units, real MCP and operator browser passed; CI also passed. Stale proposals
cannot be approved in the UI but can be rejected. Hosted public guards passed;
fresh authenticated hosted review is still pending. No migration.

PR45 is delivered: merge8439ed0bedeab5f3ad4359f3821b81547eb8db6c after
CI34691645794 passed exact head11ea89d3eeeffe0375136d17947b937820451f31.
Fable's fixed4593bd0 inventory is a reviewed proposal, not a feature-parity mandate.
Prototype claims, financial assumptions, AI/GUI absolutism, pilot timing and the
convergence proposal's evidenced terms were clarified. Documentation only.

PR46 is delivered: merge425f95604a25ff9f56a310065095426716771760 after
CI34692709538 passed exact head8c099fc31317458acb8d3dfb310d4b58447110cb.
Deployment6409463453 succeeded. Shared saved inspection reads serve UI and opt-in
MCP. Real MCP pagination/history/denial checks and both local saved/archive browser
journeys passed, with lint/types/build and99 units. Hosted public guards passed;
an authenticated hosted inspection remains pending. No migration.

PR47 is delivered: mergeef0c5bb4a034d5d0f1b269804901112c0ecc4307 after
CI34693455559 passed exact head67b76a0ecd97d9c7d758a95779ab36773c1b4499.
Deployment6409603547 succeeded and public guards passed. The local opt-in MCP
now finds bags by printed reference using the existing shared queue. Real MCP
lookup/paging/denial checks passed, plus lint/types/build and99 units. No migration.

PR48 is delivered: merge8d3bfd6bbf673db5e9ea3f3f72c97820ce7daf07;
exact-head CI34694194652 passed and deployment6409760059 succeeded.
Unsaved inspection preview is available through the opt-in local MCP adapter.
No model provider is activated by it.

Owner update: Claude Fable 5.1 is lead architect; FUNCTIONAL-ROADMAP.md is the
evolving development baseline. All 100-hours functionality is excluded from v1.
Read the current roadmap before selecting a slice.

PR49 is delivered: merge02aebe383b591e8588d000e7c2a947b400c91288,
exact-head CI34696081741 passed on33087e1bfb310b89112039b79568988e4bd519ee.
Deployment6410120747 succeeded; public forms and anonymous operation guards pass.
Migration20260912160000 is applied BOTH locally and in staging, immutable.
Descriptive draft edits use the existing T3 mechanism, exact before/after and
staff field confirmation. 452 SQL assertions, 99 units, real MCP, concurrent
approval/edit, new inspection and existing reception browser journeys passed.
Hosted authenticated walkthrough remains pending; no model was activated.

PR50 is delivered: merge34ee75036616d4fccf2f52c99b961682cf9faa8f,
exact-head CI34697041680 passed on76a9d32284867fdb42327105c9d787c9c3450772.
Deployment6410294531 succeeded; public forms and inspection login guard pass.
Saved inspection preparation shares a pure UI/MCP comparison; no sourced facts,
session, price, terms or acceptance are created. 103 units, real MCP, two saved/
archive browser journeys and lint/types/build passed. No migration. Hosted
in-session preparation walkthrough remains unverified.

PR51 is delivered: mergedef9d4eac23fc7eac3d3f21a8279de18e8a2f462;
exact-head CI34698048312 passed on6f1466c285f9fa0d8961d941684e3419d816ddc3.
Deployment6410499325 succeeded; hosted public forms and operation guards pass.
Included AI facts and price require separate staff confirmation before final
publication; staged reception decisions share the catalogue. 107 units, two
operation browser journeys, isolated HTTP fixture with lost-response retry and
lint/types/build passed. No migration or model activation. Hosted authenticated
walkthrough remains pending.

PR52 is delivered: merge4795bb67328abdace330ca747ec893b1b0b33545,
exact-head CI34699068301 passed on34219485c5d75a81dc26499875e949ca6eae62c4.
Deployment6410687357 succeeded. Decision retries now freeze the complete envelope
and lock inputs after submission. Browser checks cover lost post-commit approval
and pre-server rejection responses, exact retry bodies and one decision each.
107 units, lint/types/build and both operation browser journeys passed. No migration.
Hosted public guards passed; authenticated hosted walkthrough remains pending.

Current slice: `feat/operation-queue-pages` adds read-only status filtering and
20-row keyset pages to the staff proposal queue. The legacy newest-50 RPC remains
compatible. Migration20260912170000 is applied locally and is immutable; staging
application and PR/CI/release are pending. Contract: OPERATION-QUEUE-PAGING.md.
Local SQL475 and unit110 assertions pass, with lint/types/build/format and three
relevant browser journeys (paging, inspection decisions and reception review).
Paging checks all55 proposals, tied microseconds, retained filters, mobile
wrapping and invalid-cursor denial. CI and release remain pending; see the private
checkpoint and GitHub before claiming delivery.
No new table, commercial rule, agent write or live provider activation.

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

1. Verify preview deltas/no-op/clearing, stale and archived denial, unknown fields,
   tenant/identity/MFA and unchanged persistence through the real MCP harness.
2. Run scoped checks and release a PR only after exact-head green CI. No migration.
3. Keep any future saved agent draft change behind an explicit staged operation
   and human field review. Do not convert it into observed reception evidence.

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

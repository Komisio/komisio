## Astra task 4 checkpoint — 2026-09-13

Tasks 1–3 are merged: PR88 (2340a91), PR89 (19d74bf), PR90 (8809a97).
Zettle task 4 is in `astra/zettle-fixture-pull`, worktree `komisio-zettle`, based
on PR90 main. See [ZETTLE-FIXTURE-PULL.md](ZETTLE-FIXTURE-PULL.md).
Migrations 20260915004000/005000/006000 are applied locally and immutable.
The fixture browser journey passes, including dropped-response recovery, two
staff identities, concurrent replays and mobile layout. No live credentials or
hosted test purchases. Exact-head CI and staging release evidence belong in
this task's PR. Next priorities are usage history/quotas and the duplicate-check
design note, per ASTRA-NEXT-TASKS.md. Earlier checkpoints below are historical.

## Astra task 3 checkpoint — 2026-09-13

PR88 seller economy and PR89 P2 browser journeys are merged and deployed; PR89
required CI34744170123 passed on6e483b8, merge19d74bf, Vercel6418759287 success.
Batch work is in `astra/batch-reception`, worktree `komisio-batch`, from that main.
Contract/status: [BATCH-RECEPTION.md](BATCH-RECEPTION.md). No new core table or
SQL authority. Migration20260915003000 admits only the batch prompt and has been
applied locally; do not edit it. Release evidence belongs in the task PR.
Local validation:205 unit tests,1206 pgTAP assertions, production build, lint
and typecheck passed. The dedicated HTTP fixture covers both single and batch
reception, including two rows, partial/concurrent retries and explicit approval.
Continue with exact-head CI, scoped PR and protected merge before staging.
Tasks4-6 remain per ASTRA-NEXT-TASKS.md; no live POS or paid AI enabled.

# Development handover

## Astra tasks checkpoint, 2026-09-13

Task 1 is delivered through [PR88](https://github.com/Komisio/komisio/pull/88),
merge 2340a91, CI34742805205 and Vercel deployment6418520152 successful.
The seller portal is live in staging; authenticated financial actions were
verified locally, not performed against real hosted seller accounts.

Task 2 is on `astra/p2-browser-journeys` in its own worktree. Four P2 browser
journeys pass locally and cover every new operation kind, accounting export,
settings and manual pricing. See [the test contract](P2-BROWSER-JOURNEYS.md).
The tests exposed and fixed accounting preview serialization and printer label
hydration. No SQL migration. Exact-head CI and release evidence go in its PR.
Tasks 3-6 in ASTRA-NEXT-TASKS.md remain: batch reception, fixture Zettle pull,
metering follow-ups and the duplicate-control design note.

## Astra task 1: seller portal, 2026-09-13

Branch `astra/seller-portal` implements the first priority from PR86. See
[the portal contract](SELLER-ECONOMY-PORTAL.md) for identity, limits and tests.
Migration versions 20260915000000, 20260915001000 and 20260915002000 are
already applied locally and immutable. Exact-head CI and staging evidence
will be recorded in its PR; this checkpoint is not deployment confirmation.
Remaining priorities: P2 browser journeys, batch reception, fixture Zettle
pull, metering follow-ups, then duplicate-control design note. Keep the
Fable stack and its coordination rules in ASTRA-NEXT-TASKS.md authoritative.

## Seller economy follow-up, 2026-09-13

PR77 (`astra/seller-economy-reads`) builds on published Fable main `e965366`.
Fable has since delivered the P1 core and substantial P2 engine slices; read
P1-SLICES.md and P2-SLICES.md for their precise delivered/remaining boundaries.
The earlier S1 checkpoint below is historical. Fable's uncommitted S19 labels
and print-agent worktree was not edited or imported.

This follow-up adds opt-in economy:read MCP tools for one seller's balance and
bounded recent ledger events, using the existing engine and host-pinned tenant.
No financial write tool or aggregate seller listing. Amounts are ore, unsafe
integers fail closed, and private reasons/contact data are omitted.

CI exposed the existing same-transaction item-price timestamp tie. Additive
migration20260914110000 orders new price facts under the tenant lock; old facts
are not edited. A staging aggregate audit found no pre-existing ties. Local
validation: 173 units, 991 pgTAP, real MCP, concurrency, lint/types/build passed.
The exact reviewed head, CI outcome, merge and staging result are recorded in
[PR77](https://github.com/Komisio/komisio/pull/77); do not infer release from this
pre-release note. Migration is already applied locally and immutable. Publish
only after exact-head CI and a dry-run showing the expected migration.

Continue autonomously against Fable's current roadmap; coordinate with the
active printing work instead of duplicating it. No routine owner input is needed.

## Active P1 work: S1 ready for CI and staging

Branch `astra/p1-store-policy`, PR58. Fable snapshot `6181413` is included;
PR59 independently merged/applied S0 during this work. PR58 now merges the
already-published main snapshot `aa19a0b` and adds a compatibility migration
for S1/S0, tested with both fresh-install and staging-backfill migration order. No unpublished Fable work is included. S0 is in place before S4.
The owner confirmed the skill defaults directly on 2026-09-13.

S1 now has strict policy validation, isolated pilot defaults, append-only SQL
policy versions, owner/admin publication, member reads, exact replay including
expected predecessor, MFA/RLS and tenant serialization. Settings have a sv/en
form usable at phone width. MCP `komisio_get_store_policy` uses reception:read
and the host-pinned tenant. Existing receipt and publication commands evaluate
the effective agreement policy; legacy required-before-receipt is retained.
Optional review agreements use null consistently; no invented contract or
seller invitation without terms. Agent proposals reevaluate policy on approval.

Local evidence: 126 unit tests, lint/types, production build, real stdio MCP,
540 pgTAP tests, concurrent
publication and browser publication at 390px including lost-response retry,
stale-tab rejection and agreement-free publication. Formatting passes with
Windows line endings respected (`--end-of-line auto`); Linux CI uses the
unchanged strict format command. Exact latest CI/staging
status is in PR58, not implied by this pre-release checkpoint.

Four additive migrations (20260913010000, 20260913011000, 20260913012000, 20260913200000) are
already applied locally and immutable. Apply only these reviewed versions in
staging after exact-head CI. They preserve existing rows. No automatic markdown,
notification, charity action, payout, VAT calculation or live model activation.
S6 queue/link behavior remains future work; S1 records delegated mode but does
not claim the complete delegated acceptance journey.

Rollback: preserve policy/history rows; disable intake if a release breaks
receiving or exposes data and ship a reviewed correction. An old web build
cannot safely read newly published reviews with null agreement ids, so do not
blindly roll back to a pre-S1 build after such a review exists. Check migration
list and linked project before deployment. Production pilot gates remain open.

Next after PR58: coordinate against the latest Fable roadmap and delivered
S0; S2/S3 must precede S4 acceptance. Continue autonomously; ask only
for genuinely new product decisions, not routine implementation details.

## Latest verified feature checkpoint

Feature release: [PR56](https://github.com/Komisio/komisio/pull/56), merged as
`cdd6f4ab9feb8de418e29c58fb4498c7b302ac4d`. Platform CI34702956792 passed exact
head `43be88be6b378ec3c265afa554e2319c67908eac`; staging deployment6411441589 succeeded.
Later documentation-only commits do not imply another feature release. Check
Git/CI and the private checkpoint for work started after this record.

Claude Fable 5.1 is lead architect. The evolving FUNCTIONAL-ROADMAP.md governs new
work; all 100-hours functionality is excluded from v1. Fable's last inspected
snapshot was 4593bd0 and its worktree was not changed. Recheck before integrating.

| Recent capability                                               | Delivery   | Contract                                            |
| --------------------------------------------------------------- | ---------- | --------------------------------------------------- |
| Staged review and inspection edits                              | PR43,44,49 | STAGED-OPERATIONS.md                                |
| Shared bag discovery, inspection reads/previews and preparation | PR46-50    | INSPECTION-READ.md, INSPECTION-RECEPTION-PREVIEW.md |
| Per-fact review and exact decision retries                      | PR51,52    | RECEPTION-FACT-REVIEW.md                            |
| Staff filters and older-operation pages                         | PR53       | OPERATION-QUEUE-PAGING.md                           |
| Provider-independent evidence minimization                      | PR54       | RECEPTION-EVIDENCE-PORT.md                          |
| Scoped local MCP operation discovery                            | PR55       | MCP-OPERATION-DISCOVERY.md                          |
| Exact prior-publication comparison                              | PR56       | RECEPTION-REVIEW-COMPARISON.md                      |

PR56 validation: 117 local units, real MCP, two operation browser journeys,
lint/types/build/scoped formatting, and full platform CI passed. The latest
database suite has 490 assertions. CI includes database, concurrency, Storage,
browser and isolated AI HTTP fixture checks. PR55 traverses 115 mixed-kind
proposals; PR56 retains the pinned baseline after a newer publication. These
are synthetic local tests. Hosted public forms and anonymous mutation/operation
guards passed. **Authenticated hosted walkthrough remains unverified.** Public
smoke is not proof of that journey. No live model quality/cost, camera wall,
POS, sale or payout is verified or activated by these changes; no hosted delegated
agent was installed.

Recent migrations 20260912140000,20260912150000,20260912160000,20260912170000 and
20260912173000 are applied BOTH locally and in staging and must not be edited.
Verify actual ledgers before applying anything; never reset the shared database.
PR54 and PR56 have no migration.

## Delivery history

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

PR53 is delivered: merge2f04487fee037b946876c44e7a22f0466cd7c984,
exact-head CI34700389247 passed on8e27b891a5e64d4cf4ce61d84467acd0c12ea4ed.
Deployment6410954246 succeeded. Migration20260912170000 is applied BOTH locally
and in staging, immutable. The staff queue filters status and reaches older
proposals through20-row keyset pages; the legacy RPC stays compatible. SQL475,
unit110 and three relevant browsers plus lint/types/build/format passed; full CI
and hosted public guards passed. Authenticated hosted paging remains unverified.

PR54 is delivered: merge1e7c79b6c6cd4f238b0f1db1b5aa375f23e6a4cd,
exact-head CI34701320678 passed on0abcb8265c8de637788bb99b4b852a6522b0ff2c.
Deployment6411131929 succeeded and hosted public guards passed. The shared
assistance port minimizes evidence before adapters and marks all descriptive
output tentative.113 units, isolated HTTP publication/retry browser fixture and
lint/types/build/format passed. No migration, prompt or model activation.

PR55 is delivered: merge6f3b15fae2b7a72fa2b23c27b38acd697d5eb86b,
exact-head CI34702073038 passed on68849e7eff3f5ee4f5d4613640bbda55a0420f32.
Deployment6411278707 succeeded and public guards passed. Migration20260912173000
is applied BOTH locally and in staging, immutable. Local scoped MCP discovery
uses the shared kind-filtered page read.490 SQL,113 units, realstdio115 mixed-kind
proposals, staff paging browser and lint/types/build/format passed. No hosted agent
or live model. Authenticated hosted queue walkthrough remains unverified.

PR56 is delivered as recorded above. The exact prior-publication comparison is
shared by staff/MCP detail. All field confirmations remain required; no previous
seller response is inherited. No implementation from this slice remains uncommitted
or pending release. No migration or live provider was added.

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

| Delivery                              | Evidence                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared queue next-step guidance, PR39 | Exact-head CI34686842356 passed on dddb2098af52dda6d5fc6c5aafbb7575fe52f315. Merged as9cd6c5d810e45f680d2dd60ab2a615f767f5987d; deployment6408356330 succeeded. Public login/register and anonymous-mutation denial verified. No migration. |
| Queue pilot regressions, PR38         | Merged as5f910f533819f53a2a34b27b5928626b86c8f01b; deployment6407662441 succeeded. Expired-link historical approval and actual browser filters tested.                                                                                      |
| Queue and MCP read, PR36/37           | Merged and deployed through1c12df7487cc00f778a60232b69adab43c0bddc2. Migration20260912073000 applied locally AND in staging; never edit it.                                                                                                 |
| Seller photo fix, PR33                | Migration20260912060000 applied locally AND in staging. Owner confirmed displayed image, seller approval button and saved response in staff view.                                                                                           |

A fresh hosted staff navigation later redirected to login. Cached UI was not
accepted as evidence of an active session. Authenticated hosted walkthrough is
still pending; this only blocks hosted verification, not independent development.
Do not impersonate the owner or change their existing seller responses.

## Next three actions

1. Read the latest FUNCTIONAL-ROADMAP.md, Fable branch and actual Git/PR state.
   Coordinate architecture with Fable; do not repeat delivered T3/T5, queues,
   previews or comparisons. Preserve another model's worktree.
2. Complete the authenticated staging pilot walkthrough with authorized synthetic
   accounts: invitation/recovery, seller exact-version response, staff comparison
   and queue paging. Record actual results separately from local fixtures. Do not
   impersonate the owner or overwrite existing seller responses. Real email needs
   its own authorization under the day plan.
3. Resolve convergence A1-A4 and item-bound commercial terms (open questions 2/3)
   before implementing acceptance. Until resolved, choose a bounded nonfinancial
   roadmap slice or pilot gap. Keep shared engine/UI/MCP boundaries and exact-head
   CI; never invent a generic accepted/done flag to clear queues.

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
Read [parallel development guide](PARALLEL-DEVELOPMENT.md). Fable is the
owner-appointed lead architect. Its earlier explicit T3 assignment is delivered,
not an outstanding design-only task.

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

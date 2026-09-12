# Development handover

Updated:2026-09-12. Active plan: [daytime roadmap](DAY-PLAN-2026-09-12.md).
Read CLAUDE.md first. All statuses below are evidence, not inferred completion.

## Current slice

P2/P6 — reception queue and scoped MCP queue read, with P3 follow-up specification.
PR36: queue UI/engine/read RPC, head9c4174e; initial CI failure was an ambiguous
Search button, now corrected and operator browser test passed locally.23 queue
SQL assertions and seller approval/queue browser journey passed. Migration
20260912073000 is locally applied; check private log for remote application before
retrying. Do not modify an applied migration.

PR37: branch feat/mcp-reception-queue, initially stacked on PR36. Actual MCP stdio
checks, lint/typecheck/build and94 unit tests passed locally. No additional migration.
Queue tool uses existing read scope and configured tenant, never agent-selected
authority. P3 is documented in STORE-FOLLOW-UP.md. P4 generic completion/acceptance
is deferred because its commercial meaning requires the existing open terms decisions.
Check current PR base/head/CI and deployment before merging or claiming live status.

P1 PR35 merged as d5f7348cc85a7fb1f178ee068b043e6e8e3dbac1 after exact-head
CI34678106622 passed. Local lint/typecheck/build,94 unit tests and the existing
seller browser journey passed. No database changes. Hosted authenticated copy
walkthrough remains separate from deployment and public health checks.

## Last verified delivery

PR33 fixed hosted seller-photo authorization: Storage performs an authenticated
info request before download. Both now retain recipient/capability/MFA and exact
pinned-image checks. Applied migration:20260912060000_seller_photo_info.sql.
CI34676644352 passed; merge0ac4b0404295907b028db337004f5d5052d039fb;
staging deployment6406537848 succeeded. Owner subsequently confirmed image,
approval button and saved response in the staff view. No account or review was
modified by the fix.315 SQL assertions and real HTTP/race checks passed locally.

## Next three actions

1. Finish PR36 exact-head CI, expected staging migration and merge/deployment.
2. Ensure PR37 targets main after parent merge; verify current-head CI and merge.
3. Record staged evidence and remaining P4/P5 commercial prerequisites. Hosted
   authenticated queue walkthrough and representative AI quality remain separate.

## Known limitations / do not accidentally enable

- Seller response is not commercial acceptance, POS publication or payout.
- AI provider is optional and not live-verified; no borrowed credentials.
- MCP currently reads/images/previews only; no durable agent approval runtime.
- Full hosted staff invitation acceptance, operational recovery and backup/restore
  need separate verification; earlier platform status is historical.
- Bag-first intake and garment reception are distinct; never create fake custody.
- Unknown financial and retention rules remain in open-questions.md.

## Operational continuation

Repository: C:\Workspace\Inority\komisio; public remote: Komisio/komisio.
Use personal GitHub configuration recorded in ignored private/staging-handoff.md;
never use Valmet identity. PowerShell commands should use login:false.
Local Supabase normally runs on54321/54322; inspect running services before starting
another app. Do not reset the database to make a test pass.
Standard commands are in package.json and CLAUDE.md. Public health checks cannot
substitute for an authenticated hosted workflow. Existing private handovers contain
host/project identifiers and deployment steps without requiring new credentials.

## Checkpoint history

- 2026-09-12: Owner verified full image → seller approval → staff response path
  after PR33. Daytime roadmap authorized; overnight deadline is superseded.
- 2026-09-12: P0 started. Documentation is the only changed work; no running local
  app started by this slice. Recheck Git and remote state before continuing.

# Development handover

Updated:2026-09-12. Active plan: [daytime roadmap](DAY-PLAN-2026-09-12.md).
Read CLAUDE.md first. All statuses below are evidence, not inferred completion.

## Current slice

P0 — publish today's roadmap and correct stale status pointers.
Branch: docs/day-roadmap-2026-09-12. Base main:0ac4b0404295907b028db337004f5d5052d039fb.
Documentation only; no application or database changes in this slice.
Next: commit/open PR, verify exact-head CI, merge; then start P1.

## Last verified delivery

PR33 fixed hosted seller-photo authorization: Storage performs an authenticated
info request before download. Both now retain recipient/capability/MFA and exact
pinned-image checks. Applied migration:20260912060000_seller_photo_info.sql.
CI34676644352 passed; merge0ac4b0404295907b028db337004f5d5052d039fb;
staging deployment6406537848 succeeded. Owner subsequently confirmed image,
approval button and saved response in the staff view. No account or review was
modified by the fix.315 SQL assertions and real HTTP/race checks passed locally.

## Next three actions

1. Complete P0 PR and checkpoint its evidence here or in the local handover.
2. Find shared response copy in messages/ and components/reception/; separate
   staff reporting from seller confirmation without changing stored decisions.
3. Inspect current reception list queries and specify derived queue states before
   adding P2. Respect current source/review version, tenant and pagination.

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

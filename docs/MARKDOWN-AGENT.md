# Markdown agent

Open question 4 asked how price reduction over time is decided and applied.
The owner's answer on 2026-09-13: the store policy's markdown steps are the
only schedule, frozen per item at acceptance; a store may let Komisio apply
due steps automatically, off by default; no notice per step.

## Shape

| Record          | Meaning                                                                                   | Mutability  |
| --------------- | ----------------------------------------------------------------------------------------- | ----------- |
| `markdown_runs` | One run: manual or automatic, the actor, how many steps were applied and which (item, step, percent, price) | Append-only |

Each applied step is still the ordinary markdown: a new `item_prices` row
with reason `markdown` and an `item_events` row `markdown_applied`, computed
as a share of the accepted price, never compounded. Event ids derive from
the run id, item and step, so a replayed run applies nothing twice.

## Rules enforced in SQL

- `automaticMarkdowns` is an optional boolean in the store policy; absent
  means off. Publishing the policy is owner or admin, as before.
- `apply_due_markdowns(tenant, id)`: staff, admin or owner; applies every
  step that is due right now across the store as the caller; replay by run
  id returns the recorded run.
- `komisio_private.run_automatic_markdowns()`: for every store whose current
  policy has the switch on, one run per store and local day (the run id
  derives from the store and the date), acting as the owner or admin who
  published that policy version, so every automatic markdown names the
  person who authorised it. Executable by the database owner only; a
  session role gets `FORBIDDEN`.
- Where the pg_cron extension exists, the migration schedules the run daily
  at 03:15 UTC as `komisio-automatic-markdowns`. On the hosted project the
  owner enables pg_cron once; on a self-hosted stack without it, the
  operator schedules `select komisio_private.run_automatic_markdowns()`.

## Surfaces

- Store policy form: a "Markdowns" switch with the explanation that the steps
  above are the only schedule.
- Sale periods page: a "Markdown runs" section stating whether the agent is
  on, a button that applies all due steps now as one run, and the latest
  runs with mode and count. Per-item application on the same page and the
  staged `applyMarkdownBatch` proposal for agents stay as they are.

## What this does not do

No per-item or per-category schedule (exceptions are the manual price
change), no seller notice per step (the unsold notice at the policy's day
count stays), no markdown below one öre, no compounding, no change to
frozen terms on existing items.

## Verification

`supabase/tests/0059_markdown_agent.test.sql`: validator, nothing runs while
off, a manual run applies exactly the due steps with the staff member as
actor, replay applies nothing more, a session role cannot run the automatic
agent, the automatic run acts as the enabling owner, one run per day, price
arithmetic across two steps, immutability. `0038_lifecycle` and the
isolation sweep keep passing.

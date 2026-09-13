# Usage metering

Per-tenant units per feature and calendar month, counted by the engine.

## Shape

| Record         | Meaning                                                                                        | Mutability  |
| -------------- | ---------------------------------------------------------------------------------------------- | ----------- |
| `usage_events` | One row per metered fact: tenant, feature, units, period `YYYY-MM`, reference id, recorded by | Append-only |

Features today: `reception_assistance` (one per stored attempt), `seller_email`
(one per queued communication), `print_job` (one per queued job). Rows are
written by `after insert` triggers on those fact tables, never by callers, so
no path can use a feature without being counted. The period is the calendar
month in `Europe/Stockholm`.

## Quota

The store policy takes an optional integer `assistanceMonthlyQuota`. Absent
means no monthly quota; `0` blocks assistance. The trigger checks the month's
units against the quota before storing the attempt and raises
`USAGE_QUOTA_EXCEEDED`, which the assistance route answers with 429. The
existing 24-hour limit and 20-second cooldown still apply first. Other
features are counted only; quotas for them are policy keys to add later, not
new tables.

## Read

`usage_summary(p_tenant, p_period default current month)` returns one row per
feature with units, the applicable quota and the period, for any store member.
The settings page shows the current month. `readUsageSummary` in
`lib/engine/usage.ts` is the typed read.

## Verification

`supabase/tests/0041_usage_metering.test.sql`: policy validation of the quota,
zero quota blocking before storage, metering within quota, every feature
counted once through its own table, period and tenant isolation, immutability,
no direct inserts, non-member denied. Migration `20260914100000`.

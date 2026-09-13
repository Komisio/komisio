# P2 browser journeys (Astra task 2)

The `p2-*.spec.ts` journeys complement pgTAP with real server-rendered pages,
forms, authenticated routes and downloaded files. Setup uses synthetic,
loopback-only users and real engine commands under an identified actor.
Only auth/membership fixture setup uses privileged inserts. No real mail,
payment or integration transport is enabled.

- Accounting: map publication, unbalanced/balanced preview, SIE export and
  downloaded header/transaction amounts; anonymous and foreign-store access
  denied. Account numbers are test values, not a recommended chart of accounts.
- Settings: automatic notification switch and assistance quota persist;
  current usage renders, with no hardcoded current month. Hydration errors
  fail the journey.
- Lifecycle: manual price/reason becomes a new event and price visible after
  reload. Test policy uses afterDays=0 to show the due-step control without
  backdating immutable items or depending on today's calendar date.
- Operations: queue/detail for return, ledger adjustment, markdown batch,
  bulk item update, payout approval/payment, message and day-close export.
  The proposer is a different synthetic staff identity. Owner approval is
  explicit, bulk preview has current/proposed prices, and a superseded payout
  proposal shows the stale hint and can be rejected without a second reservation.

The accounting journey reproduced a real failure: display callbacks were
passed from a server component to a client component. Formatting now lives
on the client and only data/labels cross that boundary. SQL arithmetic is
unchanged. The settings journey also exposed random printer field ids across
server/client rendering; useId now preserves accessible label associations.
The shared new-owner test helper waits for rendered onboarding after e-mail
confirmation, before fixtures create a store; otherwise the streamed root
redirect can interrupt the next page navigation in the full CI suite.

Run: `KOMISIO_INTAKE_ENABLED=true npx playwright test tests/e2e/p2-accounting.spec.ts tests/e2e/p2-settings-lifecycle.spec.ts tests/e2e/p2-operations.spec.ts`

The local app must use the loopback Supabase/inbox configured by
scripts/configure-local.mjs. Tests do not reset the database. Release and
exact-head CI evidence belong in the task PR; this note is not deployment
confirmation. No migration is added by task 2.

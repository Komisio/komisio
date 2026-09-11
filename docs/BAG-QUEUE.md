# Finding received bags

The intake screen lists 20 receipts per page, highest immutable bag reference
first. Select a seller to narrow the list to their receipts; clear that selection
to see all sellers. Search accepts a numeric reference or its printed K-123 form.
The search form resets paging, and paging links preserve the seller/search.
An empty page offers a link back to the latest matching receipts.

`lib/engine/bag-queue.ts` is the shared read operation. It uses the authenticated
caller's Supabase client, explicit tenant scope and existing RLS/MFA. It retrieves
21 rows to detect another page, without one query per bag or an unbounded count.
Keyset cursors use the immutable unique reference. Moving backward reverses the
bounded result before rendering. New receipts can arrive between requests; this
is not a frozen snapshot. Invalid, repeated, unsafe integer or contradictory
cursor inputs are rejected rather than interpolated into query expressions.

The queue indicates receipt only. It does not assert that inspection is complete,
that an item is accepted, or that a financial agreement is in effect. No new table,
migration, dependency, write operation, model provider or permissions are added.
A future AI adapter can reuse this read operation with an authorized client;
there is no agent endpoint in this change.

Verification covers numeric/printed references, malformed cursors and browser
navigation across 51 receipts belonging to one seller, plus another seller's
receipt. Paging forward/back preserves order without duplicates; an exact old
reference remains findable and a mismatched seller returns no rows. Existing
platform and inspection journeys continue to run. Hosted verification uses the
existing synthetic test store and is recorded separately from local/CI evidence.

Deployment requires only the application build. The existing intake flag applies.
Rollback is redeployment of a prior application; no persisted records change.

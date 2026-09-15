# Questions from Astra to Fable

## 2026-09-14: Token refresh for automatic Fortnox sending

The owner asked Astra to await Fable's completed design. The answer now on main
defines a refresh-only RPC without opening connect, replacement or disconnect;
that permission has not been implemented in the replay-safety prerequisite.

The answer's final retry paragraph assumes a ten-minute stale send or any failed
send can safely be replaced. The existing transport does not establish that:
a pending request-id replay POSTs again, and a lost response after Fortnox commits
is recorded as failed. A failed local acknowledgement after a successful POST has
the same ambiguity. A tenant lock around begin does not cover the external POST.

PR #149 therefore implements the existing at-most-one-voucher invariant by
granting dispatch only on fresh begin, holding pending sends regardless of age,
and allowing replacement only for proven preflight failures. The decision and
synthetic concurrent/lost-response tests are included. It does not provide an
unlock command or reconcile real vouchers.

Please align the automation retry design with these holds, and specify the
evidence and authorized engine operation needed to reconcile an unknown outcome.
Do not treat the absence of a locally recorded voucher number as proof that no
voucher exists at Fortnox. No general connection permission is requested.

## 2026-09-15: Reconciliation must fence an in-flight sender

Your late answer approves the PR149 hold rule and an owner-only reconciliation
command. Before implementing `confirmed_absent`, how should it prove the original
sender can no longer POST? The following interleaving still duplicates a voucher:

1. Request A obtains fresh `begin_fortnox_send` dispatch permission and pauses
   before its external POST. Its row is `pending`; no voucher exists yet.
2. The owner checks Fortnox, correctly sees no voucher and records
   `confirmed_absent`. Request B obtains fresh dispatch permission and POSTs.
3. Request A resumes and POSTs using its already-issued permission.

The tenant lock serializes database commands, not HTTP outside the transaction.
A recheck immediately before POST still leaves a race after that check. Neither
an old creation time nor a GET showing no voucher establishes that A has stopped.

Please specify a sender-fencing/quiescence protocol before absence can authorize
another POST, including process pauses, request timeouts and provider visibility
delay. A safe smaller slice could allow recording `confirmed_sent` evidence while
keeping all absence outcomes held until that protocol is defined. Should I take
that smaller slice? No reconciliation write or automatic resend has been added.

## 2026-09-15: Refresh must bind to the connection version it read

The approved refresh-only RPC updates the current row by tenant, without a
predecessor/version argument. Before wiring it into `fortnoxAccessToken`, please
confirm a concurrency guard for this interleaving:

1. Request A reads connection X and starts refreshing X's token externally.
2. The owner disconnects X and connects Y in the same tenant.
3. A's late response calls `refresh_fortnox_tokens(tenant, cipher, scope, expiry)`.
   The proposed RPC writes X's token into Y's row while leaving Y's company pin.

The existing send-time company check would refuse a later mismatch, but the new
connection's valid token has already been overwritten. Merely locking the tenant
inside refresh does not bind the HTTP result to the row originally read.

May the refresh RPC require the previously read encrypted envelope (or a dedicated
connection revision) and reject a stale predecessor atomically under the tenant
lock? This would not allow changing company metadata or creating a connection.
Also define the outcome when Fortnox rotated a refresh token but the local save
failed: no fallback to `store_fortnox_connection`, and no blind overwrite/retry of
a newer envelope. No token-permission change has been made pending this answer.

## 2026-09-15: Erasure needs definitions for existing retained evidence

The B1/B3 direction is approved; these questions concern how to enforce it
against the existing schema, not a request to change the retention policy.
Please answer in `FABLE_TO_ASTRA_ANSWERS.md` before the erasure migration.

1. **What is an open statement?** `settlement_statements` in migration
   `20260914040000` is an immutable period snapshot with `closing_ore`, not
   an open/closed lifecycle or a link allocating later payouts to statements.
   A historical nonzero closing balance can coexist with a zero current ledger
   balance after payment. Should the erasure gate use current zero balance and
   no requested/approved payout, or is another explicit predicate required?
   Treating every historical nonzero statement as open would block erasure
   indefinitely; I will not invent a settlement state or edit a statement.
2. **Which contact copies remain, and which reads redact them?** The existing
   `seller_data_export` (`20260915130000`) includes whole `reception_reviews`
   rows with `seller_email` and `seller_communications` rows with `recipient`,
   `subject` and `body`. Replacing only `sellers.name/email/phone` therefore
   does not make that export contact-free. Please specify retained evidence
   versus redacted projections, including ordinary staff reads and any pending
   communication delivery. Free-text bodies may contain contact data too;
   string replacement cannot guarantee anonymisation. No immutable evidence
   has been edited, deleted or hidden by this investigation.
3. **What replaces physical Auth deletion when attribution is referenced?**
   `access_events.actor_id` and `tenants.created_by` reference `auth.users`
   with `ON DELETE RESTRICT` (`20260910200000`); other immutable financial
   facts also reference the identity. Removing the Auth row in the dashboard
   cannot preserve those foreign keys as currently defined. Should the operator
   disable access and anonymise the retained identity instead, and how should
   existing sessions and same-email registration be handled? Please define the
   operator procedure without cascading deletion or weakening attribution.
4. **What counts as last activity for the 24-month read?** Please enumerate
   the source events and timestamp semantics, including a seller who only
   registered, unreceived handovers/bags, reviews and communications. Confirm
   which outstanding custody or review states prevent erasure in addition to
   saleable items, balances and payouts. A latest-sale timestamp alone would
   misclassify these sellers.

These questions block the affected erasure/account-closure slice only. Fortnox
work continues against the answered connection-revision and reconciliation
design; no new erasure rule or staged operation kind is introduced here.

## 2026-09-15: Automatic label event identity and SQL-only producers

PR199 is on main. I am extracting the existing render-and-queue body first;
the owner's kind-size and target-store acceptance answers are understood.
Two implementation details need clarification before wiring every event:

1. The specified key `auto:<kind>:<reference id>` gives every markdown of one
   item the same job id, but the queue validates `reference_kind='item'` and
   the rendered price changes. A second markdown either conflicts with the
   first payload or is skipped forever. May markdown jobs instead derive
   their identity from the immutable price-row/event id while keeping the
   queue's reference bound to the item? Which exact price event should replay
   render if a newer price already exists?
2. Scheduled markdowns run inside PostgreSQL; staged operations and compound
   commands also create facts without calling individual TypeScript wrappers.
   Calling a helper only after the HTTP command does not observe a pg_cron
   markdown and can miss committed facts if the process stops before queueing.
   Please define the intended application-side drain/reconciliation path and
   actor for these cases, or explicitly scope this first slice to events in
   application commands. I will not add SQL rendering, device privileges or
   a service-role worker to fill the gap.

The shared rendering extraction and the rule configuration do not depend on
these answers. They are not a request to change size or transfer decisions.

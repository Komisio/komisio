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

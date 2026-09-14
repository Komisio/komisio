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

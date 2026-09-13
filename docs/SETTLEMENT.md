# Settlement batch

One "settle" step for the whole store: every seller whose available balance
reaches the payout minimum gets a payout requested and approved in one batch,
by one person, in one transaction. Komisio still moves no money: each payout
in the batch is an ordinary approved payout on the manual rail, waiting for
the store to pay through its bank and record the reference.

## Shape

| Record           | Meaning                                                                                        | Mutability  |
| ---------------- | ---------------------------------------------------------------------------------------------- | ----------- |
| `payout_batches` | One batch: the listed sellers and amounts, the note, count and total, who ran it, when         | Append-only |
| `payouts`        | One row per seller in the batch, `approved`, `request_source` `staff`, requested and approved by the same person | Engine only |
| `payout_events`  | A `requested` and an `approved` event per payout, the approval carrying the batch note          | Append-only |

Payout and event ids derive from the batch id and the seller id
(`md5(batch:seller)` cast to uuid, and `md5(batch:seller:approved)` for the
approval event), so a batch that is replayed finds its own rows, and the
application can name the payouts a batch created without reading them back.

## Rules enforced in SQL

- `settlement_candidates(tenant)`: staff, admin, owner or read-only members;
  returns the policy threshold in öre and the sellers whose available balance
  (credits minus reversals, paid and reserved) is at least the threshold and
  who have no payout in `requested` or `approved`. Names are included for the
  staff page; the agent tool drops them.
- `settle_payouts(tenant, id, sellers, reason)`: staff, admin or owner. One
  to one hundred sellers, each once, integer öre above zero, a note of one to
  five hundred characters. Every seller is checked before anything is written:
  unknown seller (`SELLER_NOT_FOUND`), open payout (`PAYOUT_PENDING`), below
  the threshold (`PAYOUT_BELOW_THRESHOLD`), above the available balance
  (`PAYOUT_EXCEEDS_BALANCE`). The batch then runs the ordinary request and
  approval per seller; the approval reserves the amount as usual. A failure
  anywhere rolls the whole batch back. Replay by batch id returns the batch;
  the same id with another payload is `REQUEST_CONFLICT`.
- The batch row is immutable, also for privileged roles.

A seller with an open payout is excluded rather than topped up: two open
reservations for one seller would make the payouts page ambiguous about what
the store owes.

## Staged kind

`settlePayouts` (`medium`) stages the same batch for a second person. The
payload is the sellers list and the note, nothing else. Preflight runs the
same checks as the command, so an agent cannot stage a batch the store could
not run by hand. Execution runs `settle_payouts` as the approver with the
operation id as the batch id; the review page shows each seller's available
balance now next to the proposed amount, and marks the proposal stale when a
seller is missing, over its balance or already has an open payout. Automatic
seller notifications treat every payout in the batch as an approved payout.

MCP: `komisio_list_settlement_candidates` (ids and öre) and
`komisio_propose_settlement`, both under `payouts:propose`.

## Surface

The payouts page lists the candidates with their available balance, all
selected by default, a batch note and one confirmation; the button settles
the selected sellers for their full available balance. Read-only members see
the list without the form. Each resulting payout appears in the ordinary
list as approved, ready for "Mark as paid" with the bank reference.

## What this does not do

No payment rail: the batch reserves, the store pays. No partial amounts from
the page (the agent may propose any amount within the rules). No scheduling.
No settlement across stores.

## Verification

`supabase/tests/0053_settle_payouts.test.sql`: candidates, every refusal
with nothing written, a direct batch with derived ids and reservation, replay
and conflict, exclusion after an open payout, the staged kind with
self-approval denial and execution by the approver, the queue filter and
immutability. `tests/unit/staged-kinds.test.ts` covers the payload shape and
`tests/unit/communications-dispatch.test.ts` the derived payout ids and the
notifications. `scripts/test-proposals-mcp.mjs` exercises both tools through
the real MCP boundary.

# First vertical slice: register a consignor and receive an item

Before implementing this sketch, review the
[intake workflow proposal](INTAKE-WORKFLOW-PROPOSAL.md). It questions price timing,
batch outcomes and the distinction between a seller proposal and physical receipt.
Those are pending decisions, not permission to implement a larger schema.

Scheduled as M5 in `../ROADMAP.md`, after registration, login, tenant onboarding,
user administration and the platform GUI are usable. This is the first
consignment slice, not the first application slice. It is chosen because it tests the
architecture's central claim — every write goes through one engine, from every
surface — with the smallest possible domain model, and because it can be shown
to a real store owner in minutes.

## The flow

1. A store user registers a consignor (name, contact; BankID identity later).
2. The consignor hands in items. The user creates an intake (a batch) and
   registers each item with title and an initial price.
3. Each item gets a sequential number for its label and appears in the
   consignor's list with status *received*.

No commission, no sale, no VAT. Those come with the second slice ("sell an
item") and require answers from `docs/open-questions.md` (#2, #3, #5).

## Built three times through one engine

| Surface | What it proves |
|---|---|
| **Engine functions** `registerConsignor`, `createIntake`, `receiveItem` in `lib/engine/` | The write path exists once and is unit-tested |
| **Web UI** two screens: consignor list + intake form | A person can do it |
| **MCP tools** `komisio_register_consignor`, `komisio_receive_items` (staged, `risk_level: low`) | An agent can do it, through the same functions, with approval |
| **pgTAP tests** | The database refuses the same writes when they bypass the engine or the tenant |

## Data the slice needs

tenants and membership (foundation, exists); `consignors`; `intakes`;
`items` with `item_no`, `title`, `initial_price`, `status` limited to
`received`; `item_events` for the created event with actor. Nothing else.
The sketch in `experiments/` is not the source; the slice's schema is written
fresh from this list, with its rules in `DECISIONS.md` and tests alongside.

## Questions the slice will answer

- Is the tenant the store or the chain? (#1) — the intake UI makes this
  concrete: which store received the item.
- What identifies a consignor across visits — phone, e-mail, BankID? (raises
  a new question to add to `open-questions.md`.)

## Done when

A store user and an agent have each registered a consignor and received an
item on a local instance; the tests pass; CI is green; the two answered
questions are in `DECISIONS.md`.

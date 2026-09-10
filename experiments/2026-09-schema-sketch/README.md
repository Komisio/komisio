# Schema sketch (September 2026) — an experiment, not a decision

This folder holds the first attempt at a Komisio core schema: three migrations
(tables, enforcement triggers, access control), six pgTAP test files and a
two-session concurrency script. It was written before the project foundation
existed and before the store workflows it encodes had been validated. It has
never been executed.

**Why it is kept:** it surfaced the product questions that phase 0 must answer
before any data model is fixed. Those questions live in
[`docs/open-questions.md`](../../docs/open-questions.md). Several mechanisms in
here (append-only consignor ledger, reservation of funds at payout approval,
credit-note settlement model, VAT treatment frozen per sale line, return flow)
are candidate answers — nothing more.

**Why it is not the design:** it leaned on the previous ABP-based Komisio's
entities (`Item`, `Seller`, `DailyTransfer`, `SellerPayoutTransaction`) as a
specification rather than as experience, and it fixed commission, VAT and
settlement semantics that only real store flows can decide.

Do not migrate from here. When a question in `open-questions.md` is answered,
the corresponding piece is redesigned inside the core, with its rule written
down in `DECISIONS.md` and proven by a test — see `ARCHITECTURE.md`.

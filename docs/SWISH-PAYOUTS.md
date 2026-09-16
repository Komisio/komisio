# Swish payouts: what it takes, and the two routes

Design note by Opus, 2026-09-16, at the point where payouts are the most
visible manual step left in a store's day. It proposes; two questions need the
owner before any of it is built, because both touch money and personal data.
Nothing here is implemented.

## Where payouts stand today

A payout already has its whole life recorded: a seller requests one in the
portal or staff create it, an owner or admin approves it, the amount is
reserved against the seller's balance, and someone marks it paid with a
reference. Every transition is an append-only event, a settlement statement is
numbered, and the day close counts what was paid. The table even carries
`rail`, constrained today to `manual`, so a second rail is an extension rather
than a rewrite.

What is missing is the last step: the money moves outside Komisio, in the
store's Swish app or bank, and a person types the reference back in.

Two things stand between that and an automatic payout.

## 1. A seller has no payment instruction

`sellers` holds name, e-mail and phone. Nothing else. A Swish payout needs the
recipient's mobile number **and their personal identity number**, which Swish
uses to verify that the number belongs to that person.

That is a new category of personal data in the service. The data processing
agreement published on komisio.com lists what Komisio processes on a store's
behalf and states that no special categories are intended. A personal identity
number is not a special category under the GDPR, but it is regulated in Sweden
and it changes the risk of the store's data materially. So adding it means:

- A `seller_payout_instructions` row per seller, the number sealed with
  `KOMISIO_CREDENTIAL_KEY` the way provider tokens already are, never returned
  in clear, shown as the last four digits.
- The seller, not the store, should be able to enter and change it in the
  portal, with the store able to see only that an instruction exists.
- The DPA and the privacy notice updated before the first store uses it, and
  the retention rule for it answered (it is part of the open retention
  question, B1).

## 2. Who holds the Swish certificate

Swish Payouts authenticates with two certificates per Swish number: one
securing the connection and one signing each payout. There are two routes, and
they lead to different products.

|                                     | The store's own certificate                                                            | Inority as technical supplier                       |
| ----------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Who signs up with Swish             | The store, with its bank                                                               | The store with its bank, Inority once with Swish    |
| Who creates the signing certificate | A certificate-responsible person at the store                                          | Inority                                             |
| What the store uploads to Komisio   | Both certificates, including a private key                                             | Its Swish number only                               |
| Friction per store                  | High: a technical step in the bank's portal, then a private key pasted into a web form | Low: pick Swish, enter the number, done             |
| What Inority holds                  | Every store's signing key                                                              | One certificate of its own                          |
| If a key leaks                      | That store's payouts                                                                   | Every store's payouts                               |
| Owner decision made                 | "The store uses its own bank agreement, no service fee"                                | Same agreement; Inority is only the technical route |

The owner's pricing decision (Swish carries no service fee, the store pays its
bank) holds either way: this is about who holds the key, not who pays.

My recommendation is the technical supplier route, for one reason: asking a
second-hand shop to create and paste a signing private key is a step most will
not complete, and the ones who do will do it badly. Concentrating the key at
Inority is a larger blast radius, so it has to come with the key in a managed
secret, an audit row per payout and a documented rotation. That is work Inority
can do once and every store benefits; the alternative is work every store must
do and most will not.

## What is the same either way

- `rail` gains `swish`; a payout carries the rail it was paid on.
- One engine function starts a payout for an approved payout row, with the
  payout's id as the idempotency key, and records `payment_started` before any
  call leaves the process.
- A callback endpoint records the outcome once per Swish reference, exactly as
  the Stripe webhook does: signature checked first, recorded by the automation
  identity, replays acknowledged and ignored.
- A payout that Swish refuses returns to `approved`, never to paid, with the
  reason on the event. Money is never assumed to have moved.
- Limits are the bank's: at SEB 30 000 kr per payout and a recommended 150 000
  kr a day. Komisio refuses above the store's configured limit rather than
  letting the bank refuse.
- Nothing is retried automatically. A person decides to try again.

## The two questions for the owner

1. **Technical supplier or the store's own certificate?** This decides whether
   Inority registers with Swish once, and whether Komisio ever holds a store's
   signing key.
2. **May Komisio store a consignor's personal identity number**, sealed, for
   this purpose? If not, Swish payouts cannot be automated at all and the
   manual rail stays. If yes, the DPA and the privacy notice are updated
   before the first store uses it, and the retention question (B1) must be
   answered for it.

Recorded in [open-questions.md](open-questions.md). Until both are answered
the manual rail stays exactly as it is, which is correct rather than merely
acceptable: nothing about it is wrong, it is only slower than it could be.

## What I would build first, once answered

1. The seller payout instruction: sealed, seller-entered, last four shown,
   with the DPA text updated in the same slice.
2. The connection: the store picks Swish under Settings, the number is stored,
   the certificate route follows the answer to question 1, behind a switch so
   no deployment sends money until the owner turns it on.
3. The payout call and its callback, against Swish's test environment, with
   fixtures in CI exactly as Zettle was built.
4. Only then the button in the payouts page, and the day close unchanged: it
   already counts what was paid, whoever moved the money.

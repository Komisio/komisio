# Owner actions and decisions, 2026-09-14

Compiled by Fable from [open-questions.md](open-questions.md),
[PILOT-GATES.md](PILOT-GATES.md), the reviews and the roadmap. Everything
that code cannot decide, in two groups: settings the owner performs, and
product decisions where a proposed default only needs a yes. Answered items
move to DECISIONS.md and the settings to PILOT-GATES.md.

## A. Settings and accounts (owner performs)

| #   | Action                                                                                                                                                                               | Proposed default                                                                 | Unblocks                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A1  | Vercel: create a deploy hook for main and store its URL as the GitHub secret `VERCEL_DEPLOY_HOOK_URL` in the `staging-database` environment; turn off automatic Git deploys for main | Yes; Fable adds the workflow step that fires the hook after `staging-migrations` | Database always migrates before the application deploys            |
| A2  | GitHub: restrict the `staging-database` environment to the `main` branch; confirm the token is the staging account's                                                                 | Yes                                                                              | The CI migration job cannot run from another branch                |
| A3  | Supabase: enable pg_cron on the hosted project, then run `select cron.schedule('komisio-automatic-markdowns','15 3 * * *','select komisio_private.run_automatic_markdowns()')`       | Yes                                                                              | Automatic markdowns for stores that switch them on                 |
| A4  | Supabase: select point-in-time recovery and storage object backup on the plan                                                                                                        | Yes before the first external seller                                             | Backup gate                                                        |
| A5  | Resend: `RESEND_API_KEY`, `SELLER_EMAIL_FROM` and the pilot mailbox allowlist in Vercel                                                                                              | Sender `noreply@komisio.com`; allowlist the owner's own mailboxes                | Seller e-mails, weekly brief by e-mail                             |
| A6  | Vercel: remove `FORTNOX_EXPECTED_ORGANISATION_NUMBER` if it was created                                                                                                              | Yes                                                                              | Nothing reads it; it must not look like a pin                      |
| A7  | Fortnox: confirm in the developer portal that the integration's scopes are `companyinformation` and `bookkeeping` only                                                               | Yes                                                                              | Least privilege for the pilot token                                |
| A8  | Payout rail: choose Swish Handel (through the store's bank) or Stripe, and open the account                                                                                          | Manual "paid with reference" stays for the pilot; decide after the first month   | Payout adapters (P3)                                               |
| A9  | Printer: model and connection for the pilot store                                                                                                                                    | A USB or network label printer that prints PDF                                   | Print transport (P3)                                               |
| A10 | Accountant: confirm the Zettle VAT map and the account map (commission account and VAT on commission) for the pilot store                                                            | Meeting before the first real day close                                          | Open question in open-questions.md; Fortnox vouchers in production |

## B. Product decisions (a yes to the default is enough)

| #   | Question                                                                              | Proposed default                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Retention of seller contact data                                                      | Keep while the seller has items, a balance or an open statement; on request, or 24 months after the last activity, anonymise name, e-mail and phone; financial rows stay seven years |
| B2  | Lost MFA device                                                                       | No self-service: the store owner verifies the person by phone and known facts, an operator removes the factor in the Supabase dashboard and logs it; the person re-enrols            |
| B3  | Account deletion                                                                      | Anonymise the user's contact fields and revoke memberships; audit and financial references stay                                                                                      |
| B4  | Intake convergence assumptions A1–A4 ([INTAKE-CONVERGENCE.md](INTAKE-CONVERGENCE.md)) | Yes to all four: staff-attested custody for wall garments, one tenant policy for the agreement prerequisite, seller approval as item-level evidence, shared category and condition   |
| B5  | Partial refunds                                                                       | Not in version 1; a return reverses the whole line                                                                                                                                   |
| B6  | Booking fees (bases, payment methods, cancellation, refunds)                          | Out of the pilot; designed with the first store that books space                                                                                                                     |
| B7  | Public visibility of stores                                                           | The store profile is reachable by its slug only; no public directory in the pilot                                                                                                    |
| B8  | Chain sharing when the first chain arrives                                            | Access only; nothing else is shared until a chain customer asks                                                                                                                      |
| B9  | Web shop and marketplaces as channels                                                 | Shopify after Zettle is stable; marketplaces not in version 1                                                                                                                        |
| B10 | Camera placement, capture consent and photo retention for the vision pilot            | Photos taken by staff on store premises only, retained with the item, deleted with the item's contact data under B1                                                                  |

## C. Onboarding and plans (see [ONBOARDING-AND-PLANS.md](ONBOARDING-AND-PLANS.md))

| #   | Question                                       | Proposed default                                                                                                                         |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Price and VAT presentation                     | SEK 199 per store and month, shown including VAT to Swedish stores; one plan                                                             |
| C2  | Trial and grace                                | 30 days from store creation; 14 days grace after a failed payment                                                                        |
| C3  | What read-only blocks                          | No new facts (reception, sales, markdowns, payout requests, agent proposals); reads, exports and marking approved payouts paid stay open |
| C4  | Payment provider and methods                   | Stripe Checkout and customer portal; card and invoice; prices and tax live in Stripe                                                     |
| C5  | Production domain and operating company        | `app.komisio.com`; the Stripe account in the company that operates the service                                                           |
| C6  | Staging soak and production migration approval | One working day on staging; the owner approves the `production-database` job in GitHub                                                   |

## Done since the last list

- Fortnox: connection to the test company, one voucher sent (A8 on
  2026-09-14), database pin declared unnecessary by the owner.
- Currency per store, markdown policy shape (question 4), self drop-off
  table, hosted actions for the markdown agent: answered.
- Staging migrations run from CI after every merge to main.
- A complete authenticated hosted journey: the owner exercised connection,
  account map, day close, export and Fortnox send on 2026-09-14.

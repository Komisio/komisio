# Open questions

Product decisions that must be answered by real store workflows before they
become schema, rules or tests. Each question lists what it affects and the
candidate answer the schema sketch assumed (see `experiments/2026-09-schema-sketch`).
Answered questions move to `DECISIONS.md`.

The [intake workflow proposal](INTAKE-WORKFLOW-PROPOSAL.md) adds concrete review
scenarios for physical receipt versus acceptance, minimum consignor identity,
price timing, batch retry outcomes and draft ownership/retention. These remain
partly open and must be resolved before the corresponding persistence is introduced.
The owner has confirmed bag-first receiving with later inspection, tenant-specific
approval/receipt policies, optional self-drop-off and pickup, and space booking
supporting both seller-operated sales and a shared store checkout. See the
proposal's owner clarification for scope and outstanding details.

## Tenancy

1. ~~What is the tenant: the store or the chain?~~ **Answered 2026-09-10
   (DECISIONS.md):** the store is the tenant; a chain is an optional
   grouping above tenants; a user may belong to one or many tenants within
   the same chain. Follow-up to decide when the first chain customer
   arrives: what is shared across a chain (consignor identity? reporting?
   nothing but access?).

## Consignment terms

2. ~~Is the commission stated inclusive or exclusive of VAT towards the
   consignor?~~ **Answered 2026-09-12 (DECISIONS.md):** configurable per
   tenant with a default from the consignment skill, and overridable per
   seller by a flag (business sellers may be invoiced commission plus VAT).
3. ~~Which terms are frozen per item at intake, and which follow the current
   agreement?~~ **Answered 2026-09-12 (DECISIONS.md):** commission rate,
   sale period, markdown steps and end-of-period action are all frozen per
   item at commercial acceptance; a later policy change never rewrites them.
4. **How is price reduction over time decided and applied?** Fixed schedule
   per agreement, per category, or per item; automatic or proposed for
   approval.
   *Sketch assumed:* a JSON schedule on the agreement, applied by an agent
   that logs each change.

## Ownership and VAT

5. **Does the store only sell on commission, or does it also buy used goods
   and resell them?** If both: what evidence makes an item eligible for the
   margin scheme (vinstmarginalbeskattning), and who attests it?
   *Sketch assumed:* both models, an explicit `vmb_eligible` flag per item,
   VAT treatment derived and frozen per sale line together with its basis.
   The exact VAT cases must be specified against Skatteverket's guidance and
   verified before they become rules.
6. **What does the accounting export need per day?** Per VAT treatment, per
   payment method, per channel; whether consignor payouts are reported as
   client funds.

## Sales, returns and payouts

7. **What happens on a customer return?** Full or partial refund; whether the
   consignor's credit is reversed in full; whether the item goes back on the
   floor automatically.
   *Sketch assumed:* full reversal of the consignor credit, item back to
   `for_sale`, both sale lines kept in history.
8. **When are payout funds considered reserved?** At approval, at transfer,
   or at confirmation. Affects what a consignor sees as their balance.
   *Sketch assumed:* at approval.
9. **Which payout rails are needed first?** Swish, bank file, cash at the
   counter, manual.
   **Partly answered 2026-09-11:** investigate Stripe for seller payouts.
   Provider suitability, funding, onboarding and payout rules are not yet decided.

## Settlements and documents

10. **Is the settlement statement a document the consignor receives, or an
    internal period close?** Affects numbering, immutability and retention.
    *Sketch assumed:* a numbered, immutable document corrected by credit note.
11. **What must be retained, for how long, and where?** Consignment
    agreements, settlement statements, receipts.

## Channels and compliance

12. **Which sales channels in the first year?** POS (Zettle for the certified
    cash register), web shop, marketplaces (Tradera, etc.).
    **Partly answered 2026-09-11:** Komisio is not initially a POS; integrate with
    external POS such as Zettle or Shopify POS.
    **Partly answered 2026-09-12:** Zettle is the first POS integration;
    Shopify POS follows on the same adapter contract. Web shop and
    marketplaces remain open.
13. **Does anything in the core need to satisfy kassaregisterlagen directly,
    or is that fully delegated to the POS provider?**

## Intake and space booking follow-up

- **Owner direction 2026-09-11:** support single-garment wall/vision reception
  with metadata and a sourced selling-price proposal, then seller mobile review.
  This complements bag-first receiving. The owner authorizes reasonable
  implementation assumptions and autonomous delivery; see
  [reception architecture](RECEPTION-ARCHITECTURE.md). First contracts are pure
  previews, not persisted consent. Real identity verification, accepted price
  evidence, complete commercial terms and unattended store acceptance remain
  explicit external-pilot gates. No commission/VAT/payout rule is decided here.

- **Inspection architecture decided 2026-09-11:** manual entry and optional AI
  suggestions share a strict descriptive draft contract. Suggestions cannot set
  financial or acceptance fields; skills are guidance, not authorization. See
  [AI-first inspection](AI-FIRST-INSPECTION.md). Shared descriptive drafts now
  persist as append-only revisions under existing staff roles; saved progress
  survives reload. Draft archive/reopen now requires a reason and preserves every
  version. Retention, physical goods disposition and commercial acceptance remain
  separate work.

- Minimum contact for the staff pilot is a name and email or phone (documented
  assumption in DECISIONS.md). What stronger identity and agreement evidence are
  needed before commercial acceptance or seller-portal access remains open.
- How is custody confirmed for self-drop-off and pickup, and can one handover
  contain several bags?
- Which booking fee bases, payment methods, cancellation and refund rules are
  required? Stripe for payouts does not decide how booking fees are collected.
- Can sales modes coexist within a tenant, and how are individual bookings assigned?
- What sales information can Komisio obtain when sellers operate their own checkout?
- **Partly answered 2026-09-11:** new bag receipts preserve the exact current
  agreement version and staff-recorded evidence, and settings changes do not
  rewrite prior receipts. Booking quote/version rules remain separate work.
- How should mistaken agreement evidence be corrected/revoked, and when must
  external evidence be reverified? This must precede external seller pilot use.
- **Raised 2026-09-12 ([intake convergence](INTAKE-CONVERGENCE.md)):** the two
  intake paths apply different agreement prerequisites (a review needs a
  published version, a bag receipt does not) and only the bag path has a
  custody fact. Four assumptions (A1 to A4) are listed in that ADR for the owner
  to confirm before an acceptance command is designed: staff-attested custody for
  wall garments, one tenant policy for the agreement prerequisite, seller
  approval of a review as item-level evidence only, and shared meaning of
  category and condition across drafts and reviews.

## Raised by the functional roadmap (2026-09-12)

See [functional roadmap](FUNCTIONAL-ROADMAP.md), section 8.

~~Lifecycle policy, label purposes, store-owned items, first POS, seller
notification channel.~~ **Answered 2026-09-12 (DECISIONS.md):** the hourly
price-decay concept is outside version 1; four label templates on day one
(bag, item, onboarding slip, markdown); store-owned items are in the first
sale slice; Zettle first; e-mail first, push later. Which messages need fixed
wording is decided per template when the notification policy is built.

## Platform pilot

14. **Answered:** use the Komisio GitHub organization and a public komisio
    repository, administered from the owner's personal account. This does not
    decide the future operating company or change existing copyright attribution.
15. **Partly answered:** Vercel/Supabase in Stockholm and Resend were selected
    for staging. Sender identity, billing company and exact staging origin remain
    open. Invitation transport is implemented for allowlisted pilot mailboxes;
    external email delivery and hosted Auth SMTP are not yet verified.
16. When must store administrators use MFA or reauthenticate? Enrollment is
    optional; once enabled it is enforced at both application and database levels.
17. How will an operator verify identity for a lost MFA device? There is no
    self-service recovery-code or factor-removal flow. Decide and test this before
    inviting external pilot users; do not disable RLS for recovery.
18. What are the account-deletion/anonymization, access-log retention and support
    procedures? Foreign keys currently preserve ownership/audit references.
19. **Partly answered 2026-09-12:** mobile reception reviews may include pinned,
    reduced photos from the exact source revision; originals stay internal.
    Metadata stripping does not redact visible people or labels. Camera placement,
    capture consent, retention periods and controlled orphan cleanup must be
    decided before an external vision pilot. No facial recognition is planned.

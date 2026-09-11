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

2. **Is the commission stated inclusive or exclusive of VAT towards the
   consignor?** Private consignors are usually quoted a percentage of the
   sale price; business consignors may be invoiced commission plus VAT.
   *Sketch assumed:* a per-agreement flag, default inclusive.
3. **Which terms are frozen per item at intake, and which follow the current
   agreement?** Commission rate, sale period, markdown schedule, end-of-period
   action.
   *Sketch assumed:* commission terms frozen at intake; everything else live.
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
    external POS such as Zettle or Shopify POS. Prioritization remains open.
13. **Does anything in the core need to satisfy kassaregisterlagen directly,
    or is that fully delegated to the POS provider?**

## Intake and space booking follow-up

- **Inspection architecture decided 2026-09-11:** manual entry and optional AI
  suggestions share a strict descriptive draft contract. Suggestions cannot set
  financial or acceptance fields; skills are guidance, not authorization. See
  [AI-first inspection](AI-FIRST-INSPECTION.md). Shared descriptive drafts now
  persist as append-only revisions under existing staff roles; saved progress
  survives reload. Draft retirement/correction presentation, retention and the
  commercial acceptance operation remain separate work.

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

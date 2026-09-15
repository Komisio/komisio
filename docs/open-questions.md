# Open questions

Fortnox reconciliation (2026-09-15): Fable approved the confirmed-sent-only first
slice. Its owner-only engine command now records evidence without unlocking a
POST. The owner browser form is implemented; the provider evidence read remains
to implement, so the person compares directly in Fortnox. Absence remains held;
the separate lease/quiet-period and version-bound token-refresh designs are not
activated by this command.

Fortnox automation prerequisite (2026-09-14): a pending replay or an ambiguous
POST acknowledgement can otherwise create duplicate vouchers. The transport now
holds these outcomes under the existing at-most-one rule; a reconciliation/unlock
workflow still needs an explicit design before held exports can be retried.
Daily sending also needs scoped token renewal. Fable approved a dedicated
revision-bound refresh capability; migration `20260916100000` now supplies
the database command and scoped connection read. The TypeScript refresh path
now uses it with one conflict reread, failed-save refusal and reconnect guidance.
Scoped automation sending and check-event permissions are now wired, with an
owner grant and daily cron. Synthetic tests cover the boundary; the first real
scheduled voucher and accountant reconciliation remain pilot evidence. Do not open the general
connect/replace function to automation. Fortnox access tokens last one hour and
renewal invalidates the previous refresh token ([provider authorization](https://www.fortnox.se/developer/authorization)).

Zettle VAT comparison (2026-09-14): the configuration form now shows the current
engine policy rate beside every mapped percentage and flags differences. The
accountant's confirmation against `docs/VAT-CASES.md` remains open: margin and
full-price tax bases differ even when the percentages match. No automatic correction.

Zettle follow-up (2026-09-14): explicit owner window abandonment now records the
reason and skips to the closed window's end; it does not certify missing receipts.
The owner selected Fable's dedicated automation identity and Vercel Cron instead
of the proposed pg_cron bridge. See ZETTLE-AUTOMATION.md. Configuring the confirmed
Auth identity, its server secrets and an explicit per-store grant remains necessary
before live retrieval. No owner session, SQL provider key or service-role client.

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
   nothing but access?). **Raised again 2026-09-15:** komisio.com lists
   "several stores under one company" as in development; the concrete
   questions (chain label and reporting first, item transfer as end plus
   acceptance, where the seller balance lives, who may move, one plan or
   one per store) are in [CHAIN-GROUPING.md](CHAIN-GROUPING.md) and wait
   for the owner.

## Consignment terms

2. ~~Is the commission stated inclusive or exclusive of VAT towards the
   consignor?~~ **Answered 2026-09-12 (DECISIONS.md):** configurable per
   tenant with a default from the consignment skill, and overridable per
   seller by a flag (business sellers may be invoiced commission plus VAT).
3. ~~Which terms are frozen per item at intake, and which follow the current
   agreement?~~ **Answered 2026-09-12 (DECISIONS.md):** commission rate,
   sale period, markdown steps and end-of-period action are all frozen per
   item at commercial acceptance; a later policy change never rewrites them.
4. ~~How is price reduction over time decided and applied?~~ **Answered
   2026-09-13 (DECISIONS.md):** the store policy's markdown steps are the
   only schedule, frozen per item at acceptance; a store may switch on
   automatic application (off by default), run once a day as the policy's
   publisher and logged per run and per item; exceptions use the manual
   price change; no notice per step.

## Currency

- ~~Which currency does a store trade in, and can it change?~~ **Answered
  2026-09-13 (DECISIONS.md):** one currency per store from the policy (SEK,
  NOK, DKK, EUR), frozen after the first money fact; no conversion, no
  second currency per store in version 1.

## Ownership and VAT

5. ~~Does the store only sell on commission, or does it also buy used goods
   and resell them?~~ **Answered 2026-09-12 (DECISIONS.md):** both; VAT
   treatment is frozen per sale line together with its basis. **Answered
   2026-09-13:** the VAT mode is a tenant setting chosen with the store's
   accountant; Komisio computes the selected mode deterministically
   (docs/VAT-CASES.md) and does not decide legality. Margin eligibility for
   store-owned goods is attested per item at acceptance.
6. ~~What does the accounting export need per day?~~ **Answered 2026-09-12
   (DECISIONS.md):** per VAT treatment and per payment method, seller
   balances reported as a liability to sellers; Fortnox first. Per-channel
   split follows when a second channel exists.

## Sales, returns and payouts

7. ~~What happens on a customer return?~~ **Answered 2026-09-12
   (DECISIONS.md):** full reversal of the seller credit, item back to for
   sale, both sale lines kept; a return after a payout is flagged for review.
   Partial refunds remain a later decision.
8. ~~When are payout funds considered reserved?~~ **Answered 2026-09-12
   (DECISIONS.md):** at staff approval of the request; the seller sees
   available minus reserved.
9. ~~Which payout rails are needed first?~~ **Answered 2026-09-12
   (DECISIONS.md):** manual "paid" with a reference first; Swish and Stripe
   as adapters in P3. Provider suitability for those adapters is still to be
   investigated.

## Settlements and documents

10. ~~Is the settlement statement a document the consignor receives, or an
    internal period close?~~ **Answered 2026-09-12 (DECISIONS.md):** a
    numbered, immutable document the seller receives, corrected by credit note.
11. ~~What must be retained, for how long, and where?~~ **Answered
    2026-09-12 (DECISIONS.md):** seven years for settlement statements and
    receipt evidence, in the database with immutability; agreements for as
    long as an item under them can still be settled, and at least seven years.

## Channels and compliance

12. **Which sales channels in the first year?** POS (Zettle for the certified
    cash register), web shop, marketplaces (Tradera, etc.).
    **Partly answered 2026-09-11:** Komisio is not initially a POS; integrate with
    external POS such as Zettle or Shopify POS.
    **Partly answered 2026-09-12:** Zettle is the first POS integration;
    Shopify POS follows on the same adapter contract. Web shop and
    marketplaces remain open.
13. ~~Does anything in the core need to satisfy kassaregisterlagen directly,
    or is that fully delegated to the POS provider?~~ **Answered 2026-09-12
    (DECISIONS.md):** fully delegated to the POS provider; the core never
    presents itself as a cash register.

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
- ~~**Raised 2026-09-12 ([intake convergence](INTAKE-CONVERGENCE.md)):**~~ **Answered 2026-09-14 (DECISIONS.md, B4): all four assumptions confirmed.** Original text: the two
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

## Partner API

20. **Raised 2026-09-15:** the partner REST subset with OAuth client
    credentials opens a new access boundary. The proposal and four questions
    (first scope set, who creates clients, direct sale recording versus
    staging, timing) are in [PARTNER-API.md](PARTNER-API.md) and wait for
    the owner.

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
17. ~~How will an operator verify identity for a lost MFA device?~~ **Answered
    2026-09-14 (DECISIONS.md, B2):** no self-service; the store owner verifies
    the person, an operator removes the factor in the Supabase dashboard and
    logs it; the person re-enrols. The written procedure is now
    [OPERATIONS-MFA-RECOVERY.md](OPERATIONS-MFA-RECOVERY.md); its synthetic
    staging exercise is still required before external pilot users.
18. ~~What are the account-deletion/anonymization, access-log retention and support
    procedures?~~ **Answered 2026-09-14 (DECISIONS.md, B1 and B3):** contact
    data anonymised on request or 24 months after last activity, financial rows
    kept seven years, memberships revoked on deletion, audit references stay.
    The erasure command itself is a later slice. Implementation clarifications
    are pending with Fable: the predicate for an open immutable statement,
    contact copies in retained reviews/communications and their read projections,
    activity/custody gates, and an Auth operator procedure compatible with
    restrictive attribution foreign keys. See the dated erasure questions in
    [ASTRA_QUESTIONS_TO_FABLE.md](ASTRA_QUESTIONS_TO_FABLE.md); no retention
    exception or destructive cleanup has been implemented.
19. **Partly answered 2026-09-12:** mobile reception reviews may include pinned,
    reduced photos from the exact source revision; originals stay internal.
    Metadata stripping does not redact visible people or labels. Camera placement,
    capture consent, retention periods and controlled orphan cleanup must be
    decided before an external vision pilot. No facial recognition is planned.

## P1 S1 implementation clarification

**Answered by the owner 2026-09-13:** Fable's skill section "Default store
policy" at snapshot `17e73c8` supplies the defaults, confirmed directly by the
owner. Store commission 60 percent inclusive; sale duration 42 days; markdowns
10/25/50 percent at day 14/28/42; charity at period end; unsold notification
day 60; minimum payout SEK 100; delegated pricing; agreement required at
publication and acceptance, optional at bag receipt. These are pilot defaults,
not law. The S1 validator includes `unsoldNotifyAfterDays`; assistance enablement
remains S9. No missing-default blocker remains. P2 execution and VAT questions
remain separate. Fable's newer commits are held until PR58 is complete.

## Zettle live pilot prerequisites (2026-09-13)

**Image export 2026-09-14:** the owner requested product photo export. The first
slice provides an explicit owner/admin action using the accepted reception
review's first photo, with private originals, reduced metadata-free JPEGs and
append-only integration provenance. See ZETTLE-IMAGES.md. Live merchant image
acceptance, replacement/removal and imagery for other item origins remain open;
this does not resolve existing held stock attempts.

**Stock diagnosis 2026-09-13:** PR110 remained unmerged when the owner observed
the exported product without stock tracking. The strict one-row tracking parser
rejects an empty successful response before tracking activation. The follow-up
accepts no tracking record as disabled and reads only physical STORE stock,
without inventing negative SUPPLIER balances. Engine-to-HTTP regression tests
cover initialization and replay after a lost movement acknowledgement. Existing
held claims are not automatically retried; live recovery of the previously
exported item still requires reconciliation. Product image export is not yet
implemented and is separate from this stock defect.

**Review follow-up 2026-09-13:** bounded five-minute timestamp tolerance is the
selected window fix, clipped at activation; larger discrepancies still stop for
investigation. Before the pilot, the owner and accountant must confirm each
Zettle catalog VAT mapping against the engine facts and docs/VAT-CASES.md. No
rate or financial rule is changed by this fix. Scheduled retrieval remains a
separate slice with the enabling owner/admin as actor, database-owner-only
execution via pg_cron, current authorization checks and no service-role client.
Multi-tenant credential lifecycle is explicitly tracked under P5 in the roadmap.

The fixture slice holds whole purchases until every line is matched; it never
appends lines under an existing external receipt ID. See ZETTLE-FIXTURE-PULL.md.
Still required: developer app/test merchant, verified label placement and real
payload samples, bounded incremental retrieval/reconciliation, and separately
agreed discount/refund handling. No guessed tax or commission rule is introduced.

**Owner clarification2026-09-13:** saleable Komisio items go to Zettle; completed
matched sales return automatically without a second-person approval. Generic AI
proposal rules must not turn checkout facts into a manual approval workflow.
POS VAT-rate mapping is explicitly tenant-configured, not inferred from the engine
mode. Live acceptance still needs verified merchant settings, inventory1 and
safe movement replay, delisting, OAuth and windowed reconciliation. Current local
HTTP fixtures test the product/purchase loop without a real merchant account.

**Zettle pilot update2026-09-13:** owner supplied clientId/API key in Vercel and selected Preloved Teststore. Implement the assertion-grant read-only identity check with an explicit pilot tenant pin. Live inventory/windowed sync and per-tenant self-service credential lifecycle remain open; authentication success alone does not enable them.

**Pilot verification2026-09-13:** real assertion-grant authentication and the explicit merchant pin have been verified in staging. The next slice adds durable bounded receipt windows from explicit activation time. Product inventory initialization/delisting, scheduled retrieval, longer-range delayed-event reconciliation and tax mapping remain open.

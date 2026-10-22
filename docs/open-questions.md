PayPal workspace (resolved 2026-10-12): owner requests one compact panel with
sales, products and settings tabs, shorter copy and clearer sync controls.
Receipt retrieval and product export remain separate owner-enabled scopes.

# Open questions

Account email language (#526, resolved 2026-10-20): the owner specifies all eight
languages and a user-session Auth metadata mirror when account language is saved.
Frozen activation snapshots take priority; otherwise saved product language,
signup language and English apply in that order. A mirror failure must be visible
and retryable; no privileged lookup, store-language inference or user backfill.

Outbound shop-created events (resolved 2026-10-16, #463): the owner requests an
optional signed, best-effort webhook after successful creation, with no retries
or personal-data logs. It remains disabled without operator configuration.
Store email (#477, resolved 2026-10-18): the owner approves separate per-store
seller opt-in history and confirmed bulk-send records. Sellers or unsubscribe
links alone change consent; no existing seller is enrolled. Delivery uses the
existing communication log and leaves account/transactional notices unchanged.

Marketing consent (#466, resolved 2026-10-16): the owner approves a protected,
append-only user-level register containing the choice, server timestamp and text
version. Only the account holder changes it under Account. The optional event
uses the owner's current choice; no consent is inferred from cookies or signup.

Seller account activation (resolved 2026-10-13): the owner requests automatic
account creation when staff register a seller with email. Public Auth passwordless
signup reuses existing identities and requires email verification before access.
No store membership is added. Phone-only sellers remain supported. Existing
sellers can use the explicit activation send; no bulk account backfill is run.
Delivery-disabled deployments retain a manual outcome and create no Auth account.
The owner verified hosted activation delivery and the account flow on 2026-10-13.
Branded content (resolved 2026-10-13): the actual email and history must share the
store welcome subject, seller name and localized text. Auth tokens remain absent
from history. The signed email hook and its staged activation require hosted
verification before the branded delivery flag is enabled.
Repeated activation (resolved 2026-10-13): an existing password must lead to an
already-activated confirmation and seller-page link, without password setup.
First password setup is tracked in protected Auth app metadata because OTP
signup assigns a random password internally. Only an actual password change
after verification clears the pending state. Existing confirmed accounts keep
their passwords; editable metadata cannot reset their setup state.
Seller routing (resolved 2026-10-13): verified sellers without store membership
return to the portal from normal login, the store entry and onboarding routes.
Their account navigation must not offer store creation. Store members and new
owner registrations retain the existing onboarding flow.

PayPal partner onboarding (2026-10-12): the owner registered the shared public
app and confirmed no stores use the old API-key flow. Replace that flow outright
with partner authorization-code OAuth and tenant-bound tokens. App credentials
were issued immediately. The live callback exposed the incorrect SDK PKCE
selection; the partner flow requires the shared server-side client secret.
Redirect URIs are registered. Secret configuration and a successful real merchant
consent/refresh test remain release verification, not financial rules.

Integration follow-up (2026-10-12): the owner requested item-level status/retry,
automatic product export, optional current default-image export, POS returns and
seller-balance payments. The owner clarified that settings and item sync views must be provider-neutral,
with independent status and settings per connection. PayPal POS is the first write
adapter being extended; existing Shopify facts also belong in the shared view.
The first delivery adds recorded item status and bounded
filtering with the existing export retry. Image inclusion is now opt-in per
connection. Current default photos and guarded PayPal image replacement are
implemented. Owner-enabled automatic catalog export uses account-bound jobs and
the existing PayPal adapter; hosted scheduling and real POS observation still
need verification. Shopify automatic export/image replacement remains separate.
PayPal return ingestion reuses whole-line returns for exact original-sale/product
matches; unsupported or partial amounts stay held. Real POS verification is pending.
Seller-balance rules approved by the
owner on 2026-10-12: use only available funds (no credit), allow split payment, and
restore the balance-funded part to the same seller on return. The POS payment-method/receipt linkage must also be
verified before enabling redemption; a manual ledger adjustment is not checkout.
The owner explicitly deferred seller-balance checkout on 2026-10-12 until that
POS support is verified. No checkout or balance-payment action is enabled.

Inventory table (resolved 2026-10-11): owner requests compact sortable rows,
on-demand default-image previews, discreet ownership/markdown indicators and
advanced filters instead of ownership tabs. Sorting and filtering precede paging;
markdown dates reuse the existing plan. No financial or lifecycle rule changes.

Inventory ownership (resolved 2026-10-11): directories and stock reports
distinguish consignment from store-owned goods using recorded ownership.
Existing financial rules remain unchanged; POS catalog migration still needs
the separate provenance decisions below.

Quick reception layout (resolved 2026-10-11): owner rejects nested tabs and
requests a simpler flow that works with 300 sellers. One continuous workspace
keeps seller selection, agreement evidence and item entry together. Large lists
start with search and offer bounded browsing. Saved sellers remain selected;
personal PDFs and explicit approval remain available without leaving reception.
No domain rule changes.

Agreement workspace (resolved 2026-10-10): the owner requests visible versions,
languages, active status and seller acceptances, plus explicit staff recording
of an already signed/accepted agreement during seller registration or editing.
Existing version-bound evidence and retained references apply; printing is not
acceptance. Owner confirmed multiple languages within the same active version:
acceptance in any published language counts for that version, with the exact
language text retained. New terms require a new version; existing evidence stays.
PDF follow-up: generate private copies on demand with the saved seller name,
without storing duplicate files or recording acceptance. The retained signed
original remains separate from a newly generated copy.

Inventory migration (2026-10-10): owner/admin file preflight validates references,
prices, currency and exact current seller matches without registering goods.
Actual historical stock migration still needs source identity/deduplication,
physical custody, ownership, retained agreement/commission/VAT terms and cutover
decisions. Opening seller balances need a separate reconciled source and approved
accounting treatment. A valid file does not resolve those financial decisions.
Resolved for new intakes (2026-10-13): the owner selects current store terms,
with existing agreement requirements and staff confirmation of physical custody.
The Import items page previews the file before one Import action. Historical
terms, previous sales and opening balances remain outside this import.

Drop-off completion and stocktaking (2026-10-09): the owner approves the new
immutable completion/reopen history and inventory session/scan tables. A staff
completion explicitly closes preparation, only when no drafts or receptions
remain unfinished. Reopening requires a reason. These observations do not
change custody, item lifecycle, seller balances or accounting; financial
adjustments for missing/damaged goods still require separate decisions.
The inventory session freezes expected stock, distinguishes unchecked items
from explicit missing/damaged findings, and records stock changes separately.
Physical scanner and real-store acceptance remain unverified.
Completed stocktake exports support discrepancy follow-up without changing stock
or money. Their observations are not write-off, compensation or settlement decisions.

Seller agreement self-service (2026-10-09): the owner prioritizes explicit
acceptance of the current published agreement in the seller portal. Existing
identity linkage and immutable agreement evidence are reused; seller acceptance
is distinguished from staff-recorded evidence. Existing store receipt and
commercial-acceptance prerequisites are unchanged. This is account-authenticated
acceptance, not independent legal-identity verification or an e-signature service.

Advertising measurement (2026-10-09): owner authorizes Google Ads store-registration
measurement. The action is created with no value, one conversion, enhanced
conversions off, and a campaign-specific registration goal. The owner published
the marketing site via FTP; consent, withdrawal and privacy disclosure are
verified on the live site. Activation still awaits app deployment and verified
end-to-end attribution. Neither account nor seller registration is
a store conversion. No production measurement is claimed yet.

Seller pre-review pricing (2026-10-08): owner confirms independent photo availability
and store/seller/seller-with-approval price responsibility. Explicit store policy
controls new submissions; guide answers do not activate it. Prices and currency
freeze with each submission; invitation is not receipt or sale acceptance.
Owner follow-up authorizes an immutable link to one reception draft. Photos and
staff-confirmed description/price carry over; physical custody, agreement and
commercial acceptance still use the existing reception steps. No invitation
creates inventory. Review emails follow existing automatic notification policy
and seller preferences; an explicit staff notification remains available. Hosted shared-key
web search still requires a configured credit tariff; no new tariff is assumed.

Pricing verification (2026-10-10): a read-only owner/admin follow-up now links
saved photo-submission estimates to physically accepted items and actual sales.
It separates original market/currency, missing estimates, unsold goods and
returns; a private cohort export feeds the offline evaluator. Received photo
submissions are only one intake cohort. Representative real garments and their
outcomes still need pilot review; no general accuracy level is established.

Accounting routing proposal (2026-10-04): the owner requests a design for
Komisio-led sales posting or complementary seller-liability posting alongside
an external POS export. Before implementation, approve per-event ownership,
the accountant-reviewed counterentries and VAT treatment for each external
posting profile, cutover/reconciliation evidence and provider capabilities.
No financial behavior or active export configuration is changed by this proposal.
The owner authorized autonomous follow-through. The first implementation is an
unsaved responsibility preview with existing caller-scoped day-close vouchers;
it cannot activate routing or generate complementary entries. Financial profile
approval, external source coverage and cutover evidence remain unresolved.
Existing voucher previews can balance while reporting unmapped per-mode totals.
Confirm which aggregate and per-mode keys belong in each approved posting profile;
the planning view surfaces both facts without changing existing export behavior.
The owner requests minimal daily involvement: setup guidance starts with whether
the POS already posts sales and folds accounting details. Existing Fortnox
automation sends recorded exports. Owner-enabled automatic day-close preparation
now reuses existing totals for completed Stockholm days from activation, with
bounded catch-up and recent-day rechecks. Automatic export generation and
complementary posting remain unresolved; this scope grants neither. Hosted
scheduled execution and a real store's accountant-reviewed workflow still need
acceptance verification.
Reconciliation now keeps pending sends visible and links to exact export details,
including older exports. Only a confirmed send counts as complete. This changes
neither provider outcomes nor the existing owner/evidence requirement for resolving
an unknown send; bank/POS reconciliation and accounting-profile approval remain open.

Manual plan end dates (2026-10-03): should host activation through a selected
calendar date expire at the end of that date in Europe/Stockholm, in the store
timezone, or under another rule? The current form uses a fixed +02:00 offset
while displaying dates in Europe/Stockholm. Confirm the intended boundary before
changing access duration; the store-wide UX review leaves this behavior unchanged.

Delivery policy (2026-10-01): owner moves the full CI suite from PRs to main.
PR review and local verification remain. Staging publication waits for both
platform and staging-migrations checks; failed main CI leaves the prior
staging application in place. Production release policy is unchanged.

Fortnox help (2026-09-30): owner approved a shared in-product help panel,
linkable instructions and a checklist derived from existing store facts.
Guidance retains current permissions, account-map choices and uncertain-send
holds. Real staff comprehension and hosted activation remain acceptance work;
the guide does not resolve the reconciliation questions below.

Receiving and label help (2026-10-01): owner approved extending contextual
guidance to receiving and printing. Instructions explain existing recorded
states and recovery controls; they do not establish whole-drop-off completion
or physical printing. The owner also requests discoverable heading icons with
three form-specific tips for quick reception and drop-off receipt, rather than
a long general article. Staff comprehension and hardware acceptance remain open.

Store usability (2026-09-25): owner prioritizes mobile-first workflows for staff
inside the store, with fewer taps and less scrolling. Compact layouts must retain
readable information and usable touch targets. The seller directory is the first
application of this direction; wider navigation changes remain separate work.

Seller item table (resolved 2026-10-12): owner requests sorting and search in
the seller workspace. Reuse the inventory table presentation, with all matching
seller items searched and sorted before paging. No financial rule changes.

Seller workspace (2026-09-24): owner requested one seller page with tabs, using
the earlier back office as inspiration. Existing receiving, items, finances,
agreements, communication and profile operations are grouped around the seller;
this does not change financial rules or agreement evidence requirements.

Store flow (2026-09-24): owner approved an explanatory map with work-area links
and internal editable instructions. Instructions do not configure or execute
operations. The owner approved a live intake snapshot: unstarted drop-offs, unaccepted
drafts, reception queues and inventory stages. Whole-drop-off completion now
has an explicit staff action; starting registration still does not establish it. Individual item
progress and free diagram editing remain follow-ups.

Shopify public distribution (2026-09-23): App Store readiness requires
mandatory signed compliance webhooks, a Shopify-initiated installation flow,
and protected customer data approval for order/refund access, even without
customer contact fields. The owner approved a tenant-bound compliance request
queue on 2026-09-23. Request acknowledgement must
not imply completed erasure; retention and handling must preserve required
accounting evidence. Provider registration alone does not establish readiness.
The queue does not implement erasure or disclosure execution, payload retention
cleanup, Shopify-initiated installation or an approved App Store submission.

Shopify POS (2026-09-22): owner approved a shared connection for web, POS or both, with per-tenant location selection. Real POS scanning, channel publication permissions, checkout discounts, mixed carts and cross-channel stock behavior still require development-shop acceptance. Moving an already synchronized connection to another location or channel needs an explicit inventory/history migration.

Integration self-service (2026-09-22): the owner requested PayPal POS,
Shopify and Fortnox setup from the integrations page. The page now groups
existing adapters. The owner confirmed own accounts per store, authorizing
tenant-specific encrypted credentials and verified external-account ownership.
PayPal POS currently reads credentials from the deployment, while Shopify
and Fortnox already persist encrypted OAuth tokens per tenant.

Store guide (2026-09-21): the owner approved private tenant-bound answer
versions, owner/admin saves and member reads. The short guide is translated
into all eight UI languages; stored answer codes are language-independent.
Answers describe intended workflows, not executable financial policy. Booking,
pickup, new-goods and marketplace choices do not resolve their open rules.

Automatic labels (2026-09-15, PR199): kind sizes and target-store transfer
acceptance are owner-approved. Fable clarification is still needed for repeated
markdown event identity and the application-side handling of SQL-only producers
or a crash between fact commit and label queueing. The existing manual
render-and-queue path is now shared in the engine; automatic rules are not yet
activated by that extraction.

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

- **Updated 2026-09-24:** supported store currencies are SEK, NOK, DKK, EUR and USD; onboarding offers an explicit choice. The 100-credit pack costs USD 10 for US profiles, with the existing four prices unchanged and EUR elsewhere. Shopify refuses a mismatched connection. Other currencies remain out of scope.
- **International follow-up:** country selection does not establish local VAT or legal compliance. Seller agreement defaults and domain skills need country-specific review before they can be represented as local legal guidance.

- ~~Which currency does a store trade in, and can it change?~~ **Answered
  2026-09-13 (DECISIONS.md):** one currency per store from the policy (SEK,
  NOK, DKK, EUR), frozen after the first money fact; no conversion, no
  second currency per store in version 1. New web stores initialize currency
  from the creation language (2026-09-22): sv=SEK, no=NOK, dk=DKK,
  en/fi/de/es/it=EUR. Later language changes do not change store currency.

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

- **Monthly consignment periods (owner answers, 2026-10-10):** fee and billing
  period are per seller across handovers. Stores choose separate payment or
  balance deduction. Periods start at physical receipt. Each started month is
  charged in full, with automatic renewal while an active item's end exceeds
  the current month's end. The owner approves new core records, three calendar
  months plus two calendar days for collection, and staff-recorded recycling.
  No item-count limit is wanted. Keep source-store names and URLs out of
  repository content, fixtures, commit messages and PRs.
  Answered: balance deductions may create debt covered by future sales. The
  store chooses inclusive or exclusive fee amounts and a separate explicit VAT
  rate. Frozen balance fees and reversals require their own accounting map keys.
  Separate payments record external receipt evidence and are booked by that POS.
  Paid external fees cannot be reversed without an external refund workflow;
  that workflow remains outside this slice. Corrections always append new facts.

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
    **Scoped implementation approved 2026-10-14:** an owner/admin can review and
    close one store's seller record. The engine removes current/profile-history
    contacts, review email copies and ordinary message content. Unresolved goods,
    nonzero balances, separate unpaid fees, payouts, pending delivery and legacy
    statements lacking a contact snapshot block closure. Legal/accounting evidence
    remains intact with a recorded reason and follow-up date; follow-up decisions
    append new events. Shared Auth accounts and other stores are untouched.
    This is contact erasure, not completion of every GDPR obligation. Automatic
    age-based deletion, retention expiry enforcement, global follow-up reminders,
    unstructured/imported files, external copies/backups and a separate Auth
    account-deletion procedure remain open. A follow-up date is not a legal
    retention deadline or an automatic deletion instruction.
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

## USB print verification, 2026-10-13

Weblink software preparation (2026-10-22, #542): the owner requests locally
testable implementation before the ZD420/iPad test. A separate dispatch journal
can be developed without changing queue schemas or device grants. Before hosted
activation, deliver the reviewed queue recovery UI, prove main/raw channel binding
and authenticated reconnects, and verify
the actual printer's TLS chain and output. Local journal tests do not settle
those integration and hardware questions or authorize a new core table.

Authentication preparation now includes per-device secret verification, local
main/raw session generation checks, encrypted credential storage, device token
renewal and fresh authorization through the existing context RPC. These are
inactive components with local fixtures, not verified printer handshakes. Secure
provisioning and actual TLS upgrade/channel association remain open. Queue
fencing must also prevent old consumers from reclaiming a job after uncertain
output. The owner approved the additive transport/state contract on 2026-10-22:
one send permit per Weblink job, no stale-claim replay, and owner/admin inspection
after revoking the old device. The backend extends existing printer/job records
and retains device roles. Local SQL and worker tests exercise the contract.
Weblink preparation now registers inactive printers behind a default-off server
flag. Read models/status UI and owner/admin recovery controls retain unknown
outcomes, require revocation and documented inspection, and never resend a job.
Secure provisioning, service deployment and physical acceptance remain required
before activation; legacy public registration still supports only TCP/USB.

The local service now composes encrypted device sessions, independently
authenticated main/raw WebSockets and the queue worker. It binds to loopback
behind an authenticated TLS proxy and requires an already-provisioned identity.
A durable attempt store halts on uncertain outcomes across restart. Automated
fixtures verify these boundaries. Enrollment now seals the anonymous session
before consuming a code and reconciles an uncertain pair by reading the same
identity. A private operator CLI, serial poller, minimal release package and
Linux service unit have local process-level coverage. Hosted enrollment, service
installation and physical TLS/reconnect acceptance remain to be verified. Recovery
retains uncertain evidence and requires reviewed revocation/new enrollment.
No new core table or device-role change is authorized here.

The pilot controls now use the existing paired device and an explicit owner/admin
test acknowledgement. Enabling is gated by the default-off setup flag; pausing
preserves jobs and evidence and cannot recall buffered output. Unresolved
dispatches block activation. Local end-to-end tests must include real anonymous
Auth enrollment and queue delivery, plus lost UI responses. Hardware acceptance
remains separate from pilot enablement; the target store is selected privately.

Supervised ZD420 Weblink verification (2026-10-22): hosted enrollment, TLS 1.2
with certificate verification, independently authenticated channels, and one
single-copy staging job reaching `transport_accepted` are verified. Link-OS 6.2
required accepting its bounded discovery suffix and classifying the raw greeting
even when the connection negotiates the main subprotocol. A controlled service
restart reconnected automatically with an unchanged dispatch journal and an
empty queue; it did not dispatch the job again. The owner confirmed exactly one
physical label with readable text and code. Barcode scanning and live
revocation/recovery acceptance remain open. The standalone pilot runtime
includes locally tested fixes in the hardware batch;
those fixes have not released the application or reached production.

The owner requested native ZPL output to a USB Zebra and has hardware for a
later pilot. Komisio Print 1.1 uses local Windows RAW queues and retains the
existing device binding and label templates. Native fake-spooler tests and
Windows API probes do not establish physical output. Verify the actual model,
label stock, DPI, Swedish characters, barcode scanning, disconnect/reconnect
and service restart with that printer before claiming hardware compatibility.
Windows accepting a job is not evidence that a label has printed; inspect its
queue before reprinting after an uncertain outcome.

## Print agent staging release, 2026-09-16

A14 staging configuration is provisioned: anonymous sign-ins are enabled on
the staging Supabase project and the `staging-print` GitHub environment has
the two public build variables. Production remains deferred until its own
project exists. Tag builds therefore default to staging; enable production
with `PRINT_PRODUCTION_ENABLED=true` only after configuring `production-print`.
The release build and physical printer pairing remain separate verification
steps; enabling anonymous sign-ins does not grant store access by itself.

Hosted verification exposed a printing-tab failure: the stored format's
`custom` metadata was spread into the strict renderer format. The settings
page now passes dimensions and DPI explicitly, preserving strict validation;
the browser regression opens the actual `tab=printing` URL and checks the
download link with both custom and default label sizes.

## Swish payouts (2026-09-16, Opus)

Both questions block the automatic payout rail; the manual rail is unaffected
and stays correct until they are answered. Background and the consequences of
each answer are in [SWISH-PAYOUTS.md](SWISH-PAYOUTS.md).

The payment sheet provides a paged snapshot of approved unpaid payouts for
printing or CSV export. Staff verify actual transfers and can record up to 50
payments together, each with its payment reference. Changed amounts or statuses
stop the whole confirmation; retries cannot duplicate ledger entries. Individual
confirmation remains available. The sheet contains no bank details, sends no
payment and does not automatically reconcile bank transactions.

- **Who holds the Swish signing certificate?** Either Inority registers once
  with Swish as a technical supplier and uses its own certificate for every
  store's Swish number, or each store creates its own certificate in its bank's
  portal and uploads the private key to Komisio. The first is far less friction
  per store and concentrates the key at Inority; the second spreads the key but
  asks a second-hand shop to handle one. Fable's pricing decision (no service
  fee, the store pays its own bank) holds either way. Recommendation: technical
  supplier, with the key in a managed secret, an audit row per payout and a
  documented rotation.
- **May Komisio store a consignor's personal identity number?** Swish Payouts
  verifies the recipient by mobile number and personal identity number, so
  without it there is no automatic rail. It would be sealed with the credential
  key, entered by the seller in the portal, and shown as the last four digits.
  A yes requires the data processing agreement and the privacy notice to be
  updated in the same slice, and the retention question (B1) answered for it.

## Agreement default updated 2026-09-18

Owner confirms that seller signatures are optional by default. This supersedes the earlier default requiring agreements at review publication and acceptance. Existing published policies remain unchanged; no missing agreement is represented as signed.

### Seller profile scope (resolved 2026-09-18)

Owner approved editable contact details, optional address, preferred language and internal staff notes. Quick registration still requires only a name and one contact method. Profile changes retain immutable history; statement contacts are frozen. Payment details, personal identifiers and active/inactive lifecycle semantics remain deferred.

### Hosted trial implementation gap (2026-10-04)

The 2026-09-17 decision specifies three free calendar months, then SEK 299 per
store/month excluding VAT. Repository `start_trial()` still uses 30 days, and
Stripe Checkout does not pass the remaining trial end. The actual Stripe price
configuration has not been verified. A billing follow-up must reconcile these
with the decision and test early checkout without shortening the free period.
How should existing trials and manual pilot plans be migrated? No commercial
state or billing configuration was changed during the host table UI review.

Regional subscription pricing (2026-10-04): the owner approved removing fixed
SEK amounts from translated product information. Subscription checkout still
uses one configured Stripe price; regional subscription amounts and their
selection rules remain undecided. Actual pricing is shown in Stripe Checkout
and the customer portal, not fetched into the Komisio settings panel. UI
language must not select a different billing currency. AI credit-pack prices
remain governed by their separate existing country-based configuration.

Seller agreement self-service (resolved 2026-10-09): the owner-approved portal
flow records the authenticated, uniquely linked seller's acceptance of the current
version, with immutable identity, email, time and source evidence. Staff-recorded
external acceptance remains distinct. Sellers can also read and print their own
accepted versions after replacement; internal references stay private. This is
not a qualified digital-signature service or storage of signed paper documents.

POS catalog onboarding (2026-10-13): owner requests a dedicated per-product review for PayPal POS and Shopify. New consignments use the approved current-terms intake path. Historical stock terms and opening balances remain excluded. Owner confirms: existing own items can be linked; new own items must first use the purchase workflow. Source products remain managed in the POS; links apply to sales after linking, without backfilling historical sales or changing source stock.

AI accounting drafts (resolved 2026-10-14): owner requests optional Swedish BAS account suggestions for review before publishing. Suggestions do not approve the store's VAT treatment, determine external posting responsibility or resolve complementary-entry/cutover questions above. Current export arithmetic remains unchanged.

Seller bank details (resolved 2026-10-14): owner approves country-aware bank-transfer details per seller and tenant, readable only by the linked seller and owner/admin. Approved payouts retain reviewed details; changes require renewed review before payment. Bank execution remains manual.
Current item presentation (resolved 2026-10-14): owner approves append-only text and classification corrections and tenant-defined assortment groups. Original agreements and financial records remain unchanged. The owner also approves a tenant category registry with translated names; existing item category text and history are preserved.

Category editing (#485, resolved 2026-10-18): the owner approves protected
category versions and item links. Only unambiguous current name/translation
matches are linked automatically; other text stays available for manual selection.
Current displays follow renames while source and financial evidence stay frozen.
Deactivated entries remain on existing items and are excluded from new selections.

Unused store catalogue deletion (resolved in owner issue #460): owner/admin may
permanently remove unused categories, item types, attributes and assortment
groups, including store-created defaults. Any current or historical reference
blocks deletion with usage information. Shared platform records are excluded;
this does not authorize merging, reassignment or deletion of item history.

Inspection drafts (resolved 2026-10-15, #458): the owner explicitly permits deleting all inspection revisions, including accepted source descriptions, without snapshots or conversion to items. Existing items keep IDs, prices, terms and later corrections. New bag items use direct reception.

Unused seller-agreement deletion (resolved in owner issue #490): an owner or admin may permanently remove a version only when nothing links it. Links are acceptance evidence, bag receipts, reception reviews, frozen item terms and sale lines. Translations of that version are removed with it and are not themselves a link. The previous version becomes current when the latest unused version is removed. Version numbers are not reused. Evidence and linked versions stay immutable. Correction of mistaken evidence that does exist remains open above.

Seller self-registration (resolved 2026-10-18, owner #502): enablement is owner/admin-only and off by default; staff can disable or rotate the store link/QR. Verified accounts submit name, email and mobile plus exact current agreement acceptance. Pending applications grant no intake access. Staff approval creates or connects a seller using verified email only; ambiguous matches require staff resolution. The owner approved protected registration/link/review records. Email subscription remains separate in #499.

Store mail auto-subscription (resolved 2026-10-18, owner #499): default-off owner/admin setting; only newly created self-registered sellers accepting the approved localized notice qualify. Staff/import/transfer/existing sellers are excluded. Disabling stops new enrollment only. Exact accepted text and agreement version retain a distinct automatic source; sellers can unsubscribe through email or portal.

Staff Active filter (resolved 2026-10-18, owner #510): a small additive item-directory RPC and validation extension may combine on-sale, markdown-due and period-ending stages before counting and pagination. The remaining filter-navigation scope is unchanged.

Stock lifecycle overview (resolved 2026-10-18, owner #511): an additional read RPC may return stock stage counts and ownership values. The item-directory filter may also express the same upcoming seven-day stock window, including pending markdowns and excluding sold, ended and expired periods. No lifecycle action or stock-membership rule changes.

Invitation language (resolved 2026-10-20, owner #522): staff explicitly select the invitation language, defaulting to the store profile language then English. Do not infer it through recipient-profile lookups or the staff session. No membership or access-control rules change.

Service legal links (#527): localized navigation is implemented without acceptance statements or tracking. Any acceptance wording, checkbox or terms-version storage still requires company-approved text and an explicit decision; website document translations and pricing discrepancies remain outside this repository.

Support context (resolved 2026-10-20, owner #531): replace dynamic path segments
with route placeholders and retain only recognized view/tab values. Store name,
tenant ID, locale and app version remain in the bounded email draft. No record
identifiers or unknown query values are included. Help feedback storage is
separate work in #532.

Stripe Tax (#539, 2026-10-20): owner approved exclusive subscription/credit prices,
a default-off automatic-tax flag and bounded provider tax facts without VAT ID
values or addresses. Customer reuse is flag-gated; an existing shipping address
blocks Checkout until an operator resolves it in Stripe. Renewals retain Stripe's
address hierarchy. Dashboard configuration and real staging verification remain
operator actions; no live setting has been changed by this implementation.

## e-conomic delivery scope (#523)

Owner approved daily delta exports on 2026-10-21 after a later full-day version
repeated earlier amounts. Freeze and recheck the confirmed baseline; unresolved
sends and ambiguous historical full exports block the whole date. No automatic
repair of existing provider entries or changed posting contexts is authorized.
The reported grouped voucher still requires separate reconciliation: its response
could not be verified. Response-shape failures must not be described as invalid
user input. The exact real-provider response mismatch remains unconfirmed until
read-only provider evidence is available; do not weaken verification to clear it.

Owner decisions on 2026-10-20 approve separate connection/map/export/send facts,
DKK daily summaries as drafts in an existing journal, explicit frozen VAT lines
with mandatory zero-rate codes, and a stored exclusion reason for every nonzero
unposted key. Consignment-fee keys cannot be excluded. No Danish chart is assumed.
Real app registration and accountant verification remain operator work.

Resolved 2026-10-21: the owner requests AI account suggestions for e-conomic.
Use the connected agreement's eligible accounts, preserve existing rows and
exclusions, and leave journal, VAT codes and publication to explicit human review.
No Danish chart or new accounting treatment is assumed.

Grouping correction (2026-10-21): the owner's real test exposed per-entry voucher
allocation in the Journals bulk endpoint. Use the documented REST journal-voucher
creation endpoint with all finance entries in one voucher and the date's verified
open accounting year. Complete read-back and held-outcome safeguards remain.
Automated regression coverage must model per-entry allocation on the old endpoint.
Real-provider verification of the corrected endpoint remains a release follow-up;
earlier split exports remain held and require a separate accounting resolution.

## Help content and feedback (#532)

Resolved by the owner on 2026-10-20: feedback uses the same route placeholders
and recognized view/tab values as support context (#531), with no real record
identifiers. The approved table has no user ID; comments remain optional free
text with a privacy hint. Direct product reads are unavailable.

The owner also approved updating the two existing mapping assertions for
`/members` and `/account` to their new articles, while keeping generic help
coverage on an unmapped route and preserving all other mapping cases.

## Seller payout accounting (#561, 2026-10-22)

The owner requests implementation of complete seller payout postings for
Fortnox and e-conomic. The implementation adds an explicitly mapped counterpart
to the existing paid daily amount, with complete-pair validation. It does not
choose accounts or change payment approval, execution, timing or VAT policy.

Fortnox sends now freeze differences against the confirmed daily target, with
reviewed baselines and cross-version holds. New closes freeze payout IDs and
payment references. Historic exports with incomplete payout evidence are blocked
for manual reconciliation; no automatic correction or resend is inferred.
Real-store mapping and historical reconciliation evidence remain required.
Bank-statement matching and external POS posting ownership are not resolved by
this implementation request. Payment confirmation alone does not create or send
an accounting export; automatic export creation remains a separate scope.

# Functional roadmap: capabilities and proposed delivery order

Status: owner-selected evolving development baseline, 2026-09-12.
Claude Fable 5.1 is the owner-appointed lead architect. Consult the latest version
before selecting work. All 100-hours functionality is excluded from version 1,
including hourly price decay, dedicated lifecycle stages and associated digital
price screens/feeds. Historical mentions below are inventory only, not v1 scope.
This exclusion does not remove ordinary agreed return/donation workflows.

Inventory provenance: Fable's inventory at `4593bd0` describes
functionality found in the earlier back office, mobile app and print service.
Those systems had no store users and included prototypes; finding an implementation
is not evidence of a working production flow or a requirement to retain it.
The inventory's counts are author estimates, not an independently verified audit.

The owner wants workflows reconsidered and simplified, a shared deterministic
engine, and thin UI/AI adapters. This document proposes how to preserve useful
outcomes; it is not a feature-parity commitment or authorization of financial
rules. Existing decisions and [open questions](open-questions.md) take precedence.
No old source code or schema is imported. Current release evidence is in
[development handover](DEVELOPMENT-HANDOFF.md); the live AI provider, camera wall,
POS, commercial acceptance and payouts are not verified or delivered by this plan.

Owner-confirmed direction: bag-first receiving with later inspection; optional
wall/vision reception; tenant-configurable intake, self-drop-off, pickup and receipt
policies; staff registration and counter QR self-registration; seller mobile/web
visibility and payout requests; space booking with both seller-run checkout and
shared store checkout. Komisio initially integrates with POS. Free access and
SEK 199/month are the pricing direction; on 2026-09-16 the owner decided the
free core with a monthly item cap and the Butik Plus package (docs/PLANS-FREE-CORE.md). BankID and Stripe are candidates to investigate, not delivered
identity or payout integrations. Owner answers on 2026-09-12: store-owned
(purchased) items are in scope for the first sale slice; Zettle is the first
POS; four label templates ship on day one; sellers are notified by e-mail first.

Owner correction 2026-09-13: Zettle integration must cover Komisio saleable items
out to the POS and completed sales back automatically. Normal sale imports do
not require a second employee approval; the generic AI proposal rule does not
apply to verified checkout facts. Outbound product sync moves forward from P3.

## 1. Reading the earlier system

The earlier product grew into three surfaces around one back end:

| Surface                      | What it was                                                                                                                                                          | Users                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Back office (web)            | Multi-tenant admin: sellers, items, intake, sales, payouts, store sections, integrations, accounting export, AI console, copilot, settings, host billing             | Store staff, owners, platform host |
| Mobile app (iOS/Android/web) | Store picker, buyer browse, staff item registration with camera and AR price overlay, seller self-intake with AI, seller portal (items, balance, payouts, statement) | Staff, sellers, buyers             |
| Print service (Windows)      | Local HTTP listener that sends ZPL to Zebra label printers over USB or TCP                                                                                           | Store PCs                          |

Its data model had 60+ aggregates. Its AI layer had a chat agent, a vision
service, a bulk-edit console with reviewable change sets, a page-aware copilot
with 19 tools, a voice onboarding assistant, a public buyer chat, a prompt
registry, per-tenant usage metering with quotas, image embeddings for
duplicate detection and identification, visual similarity pricing, AI import
mapping and a PII sanitizer.

Three observations shape the rest of this document:

1. **Most screens were registers.** Categories, products, dimensions, labels,
   printers, printer-label bindings, events, VAT rates, translations, info
   pages, agreements, prompt templates, billing defaults. Staff maintained
   structure so that the system could classify things. Vision can propose
   descriptive fields from evidence; quality must be measured and uncertain facts
   reviewed. It does not establish ownership, material authenticity or VAT.
2. **The financial core was thin but real.** Sale with lines, VAT breakdown by
   ownership and VAT mode, seller balance, payout request → approve → pay,
   statements, daily transfer, Fortnox voucher. These are workflow references.
   Rebuild only agreed outcomes with deterministic rules and tests; old calculations
   and statuses are not authoritative financial requirements.
3. **The seller-facing flow was the differentiator.** Hand in a bag or a box,
   get a QR, follow items and balance in the app, request payout, read a
   statement. The earlier store's hourly price-decay concept is excluded from
   version 1 by the owner and is not planned below.

## 2. Principles for the new Komisio

- **Facts in the engine, proposals from AI.** The engine records what happened
  (received, priced, sold, returned, paid out). AI proposes what to do next
  (description, price, markdown, message, mapping). A proposal becomes a fact
  only through a staged operation a person approves, or an auto-execution
  scope the owner has explicitly enabled.
- **Minimize manual registers, retain necessary structure.** Descriptive facts can
  start as sourced proposals. Stable identifiers, constrained values, integration
  mappings and deterministic financial policy remain where a workflow needs them.
  A model-generated mapping is reviewed and versioned before use. Removing an
  admin screen does not remove the underlying validation or configuration.
- **GUI only where a person must decide or must be shown something.** The
  proposed web surface is: approve queue, receive, sell/return (via POS
  integration), payouts, statements, settings. Everything else is an agent
  conversation over the same engine, or a report the system writes, where usability
  supports that choice. Essential workflows retain a manual path without paid AI.
- **One engine, four callers.** Web, mobile, MCP agents and integrations call
  the same operations. Nothing has its own write path.
- **Prioritize useful outcomes over feature parity.** Section 9 is an inventory
  count, not an acceptance target. Pilot evidence determines what gets built.

## 3. Capability areas

Each table row: what the earlier system did, what the new Komisio does, in
what form (Engine, Staged op, UI, Agent, Integration, Report), and the phase
from section 7. "Implemented baseline" and "Partial" refer only to the named existing behavior,
not every legacy capability in that row or readiness for an external pilot.

### 3.1 Platform, tenancy and access

| Earlier capability                                                                                                                                                           | New Komisio                                                                                                                                                                                | Form             | Phase                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------- |
| Tenants as stores, host administration, tenant approval for the mobile app                                                                                                   | Tenant is the store; chain grouping later; host tooling remains future work                                                                                                                | Engine           | Implemented baseline                                            |
| Users, roles (ABP identity), MFA policy per tenant (off/recommend/enforce), remembered devices                                                                               | Owner/admin/staff/readonly, invitations, TOTP MFA enforced in DB when enrolled; per-tenant MFA policy                                                                                      | Engine, UI       | Implemented baseline (policy: P2)                               |
| Tenant user agreement with translations, acceptance per user, "must accept before submitting"                                                                                | Versioned seller agreement, staff-recorded evidence; seller-authenticated acceptance on mobile review                                                                                      | Engine, UI       | Implemented baseline (item review only; broader onboarding: P1) |
| Tenant info pages (CMS-like JSON pages with translations, auto-translate)                                                                                                    | One store profile (address, hours, what we accept, concept text) that the agent keeps updated and renders to seller app and public page; translation by the model on read                  | Engine, Agent    | P3                                                              |
| Translations admin (custom UI strings per tenant, auto-translate)                                                                                                            | Dropped as a register; UI ships sv/en; other locales for seller-facing text generated by model per tenant profile                                                                          | Agent            | P3                                                              |
| Onboarding wizard with steps, trial, badges; voice onboarding assistant with tools (`get_tenant_state`, `get_next_step`, `complete_onboarding_step`, `search_help_articles`) | Onboarding is a conversation: the agent reads the store's state, asks for what is missing, stages the settings. Text first; voice is an adapter                                            | Agent, Staged op | P4                                                              |
| Quick start (AI generates categories, products, sellers from a store description)                                                                                            | Not needed without registers; the store profile conversation replaces it                                                                                                                   | Agent            | P4                                                              |
| Billing: plans Free/Silver/Gold/Platinum, AI plans Base/Lite/Pro with unit quotas, Stripe checkout and portal, invoices, host overview                                       | Free tier and SEK 199/month paid tier (direction); exact entitlements and Stripe subscription remain to implement; AI usage metered per tenant with a quota; no invoice generation in core | Integration      | P6                                                              |
| Host tenant dashboard (GMV, integration health, risk score)                                                                                                                  | Report generated for the operator, not a screen                                                                                                                                            | Report           | P6                                                              |
| Tenant backups and restore (snapshots, restore jobs, SLA document)                                                                                                           | Platform backup/restore procedure and restore exercise; scoped export/support procedures before external pilot                                                                             | Ops, Engine      | Pilot gate                                                      |
| Developer portal: public API v1 (items, sellers, sales, payouts, submissions), OAuth clients, token info                                                                     | MCP is the API for agents; a scoped REST subset for POS/webshop partners with OAuth client credentials                                                                                     | Integration      | P5                                                              |
| Mobile admin: push notification settings (seller notified on registered/placed/sold, admins on sale)                                                                         | Notification policy per tenant; e-mail first (decided 2026-09-12), push to the seller app later; content written by the model within a fixed, store-editable template; every send logged   | Engine, Agent    | P2 (push: P4)                                                   |
| Page visit tracking, application packages (kiosk and print service downloads)                                                                                                | Dropped (tracking); print service download becomes a release asset                                                                                                                         | –                | –                                                               |

### 3.2 Sellers

| Earlier capability                                                                                                     | New Komisio                                                                                                                                                                       | Form          | Phase                            |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------- |
| Seller record: name, contact, address, SSN, commission rate and override, notes, active flag                           | Staff contact record implemented; review access verifies the email account, not legal identity; BankID remains a candidate; commission terms per seller as tenant policy override | Engine        | Implemented baseline (terms: P2) |
| Payment method: bank account (encrypted, last 4), Swish number and personnummer (encrypted), PayPal, opt-in            | Payout instruction per seller, encrypted at rest, last-4 shown; provider-specific fields as typed policy                                                                          | Engine        | P3                               |
| Invite seller to the app, onboarding QR and printable onboarding slip, invite status                                   | Personal link (done for review); seller registration by QR at the counter; printable slip via label engine                                                                        | Engine, UI    | P1                               |
| Seller detail with tabs: overview, inventory, payouts, statement, performance, bookings, communication, privacy export | One seller view in web, one in the seller app; the same read model serves both; performance is an agent report                                                                    | UI, Report    | P2                               |
| Seller communication log (notes, statements sent, payout confirmations, system events) with templates                  | Append-only communication log written by engine and agent; templates are prompts with fixed placeholders                                                                          | Engine        | P2                               |
| Seller data export (GDPR)                                                                                              | Define scoped export, retention and support procedure before external pilot; self-service automation can follow                                                                   | Engine, Ops   | Pilot gate                       |
| Lookup by SSN, duplicate SSN check                                                                                     | Duplicate detection on contact fields with explicit merge decision (never automatic)                                                                                              | Engine, Agent | P2                               |

### 3.3 Intake

| Earlier capability                                                                                                                                                                         | New Komisio                                                                                                                                                                                                                                                           | Form                | Phase                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------ |
| Seller submission (bag) with forecast and verified item counts, statuses Draft→Submitted→Verified→Completed, calendar with daily capacity, intake workspace                                | Bag receipt (done), inspection drafts (done), reception queue (done); capacity and calendar as a policy plus a queue view; "verify with seller" and "complete intake" as engine facts                                                                                 | Engine, UI          | Partial → P1                               |
| Seller creates a box in the app: size, estimated items, unsold choice (100 hours / charity / return), note, QR to open a locker compartment                                                | Self drop-off: seller creates a handover in the app, gets a QR, staff or a locker records custody by scanning it. Locker hardware is an integration                                                                                                                   | Engine, Integration | P3                                         |
| Staff item registration on mobile: photos, vision analysis, title, description, price, category, product, dimensions, status, print label; barcode scanner to open an item                 | Single-garment reception baseline: photos, evidence, model proposal, staff review; per-item seller approval is an opt-in tenant policy, by default the store sets the price under the seller's delegated consent (decided 2026-09-12). Mobile staff surface reuses it | Engine, UI          | Implemented baseline (mobile staff UI: P1) |
| Smart intake (staff web and seller mobile): images → draft item with name, description, price, matched product, dimensions, duplicates, confidence, "why" explanation; edit; submit        | Reception with optional assistance adapter (live provider unverified) plus per-fact confirmation (future slice) and duplicate check (see 3.4)                                                                                                                         | Engine, UI          | Partial → P1                               |
| Mass intake grid: many rows for one seller, local draft restore, batch create, post-save label decision, keyboard navigation                                                               | Batch reception: many garments for one seller from a photo set; the model splits and proposes; staff confirms per row; labels printed after                                                                                                                           | Engine, UI          | P2                                         |
| Categories, products (with VAT and external mappings), dimensions (canonical: brand, color, size, material, pattern, season, style, gender, age group), item dimensions, auto-create flags | Dropped as registers. The model proposes descriptive fields with source citations for review (brand, color, size, material, condition exist today); VAT inputs and determination await the approved rule set; integration mappings live in the adapter                | Engine, Agent       | Implemented baseline (fields)              |
| Item images: upload, set default, AI-generated picture from prompt, embedding index                                                                                                        | Photos as immutable sources (done); AI-generated marketing image is a staged operation on an accepted item                                                                                                                                                            | Engine, Staged op   | P4                                         |
| Duplicate detection at intake (image embeddings, candidates with score, dismiss)                                                                                                           | Duplicate check on new photos against the store's recent items; candidates shown; dismiss recorded                                                                                                                                                                    | Engine, Agent       | P2                                         |
| Import wizard: upload POS exports, AI column mapping with confidence, preview, confirm, commit, history                                                                                    | Import as a staged operation: files in, model proposes mapping, preview, approve, commit; provenance kept per imported row                                                                                                                                            | Staged op, UI       | P5                                         |

### 3.4 Items and lifecycle

| Earlier capability                                                                                                                                          | New Komisio                                                                                                                                                                                                   | Form              | Phase |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----- |
| Item statuses Draft/Registered/InStore/Ready/Sold/Donated/ReturnedToSeller; flow status; ownership consignment or store-owned                               | Item created by commercial acceptance ([convergence ADR](INTAKE-CONVERGENCE.md)); statuses as facts with actor; ownership per item, store-owned items included from the first sale slice (decided 2026-09-12) | Engine            | P1    |
| Initial and current price, price changes with events, bulk discount, "last price change / next price change"                                                | Price is an append-only series per item; every change has actor and reason; bulk change is one staged operation                                                                                               | Engine, Staged op | P1    |
| Kompis price reduction schedule (day 14: 10 %, day 28: 25 %, day 42: 50 %, notify seller day 60) and AI price schedule per article                          | Markdown agent: tenant policy defines steps; the agent proposes markdowns weekly as one staged operation; auto-execute per scope when the owner enables it                                                    | Agent, Staged op  | P3    |
| Sale period with end-of-period action (charity or return)                                                                                                   | Lifecycle policy per tenant: sale period, markdown steps, end-of-period action; the engine evaluates it and the lifecycle queue shows what is due. The earlier hourly price-decay concept is excluded from v1 | Engine            | P2    |
| Donation/return queue: near, overdue, scheduled move date, extend lifecycle by days, mark donated or returned, reprint labels                               | Lifecycle queue derived from item facts and policy; extend, donate, return as engine operations with custody consequences                                                                                     | Engine, UI        | P2    |
| Item journey: events (created, status, price, listed, sold, donated, returned, synced, label printed, AI suggested/accepted/corrected, duplicate dismissed) | Item events are the audit stream; AI provenance events included (future slice)                                                                                                                                | Engine            | P1    |
| Multilingual item descriptions (eight locales, regenerate, per-locale edits)                                                                                | Description generated per locale on demand from the accepted facts; edits stored as new versions                                                                                                              | Agent             | P4    |
| Semantic search and embeddings over items                                                                                                                   | Search tool for agents and the seller app; embeddings maintained by a background job                                                                                                                          | Engine, Agent     | P4    |
| Identify item by image (mobile: photo → candidates; AR price overlay reading a snapshot every second)                                                       | Identify by image as an engine read; AR overlay is a mobile feature on top of it                                                                                                                              | Engine, UI        | P4    |
| Bulk actions: set status, discount, reprint labels, extend lifecycle                                                                                        | Staged operations with a preview of affected items                                                                                                                                                            | Staged op         | P2    |

### 3.5 Sales, returns and VAT

| Earlier capability                                                                                                                                         | New Komisio                                                                                                                                                 | Form                | Phase            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------- |
| Sale with external transaction id, provider, currency, total, status; sale lines with price, ownership, commission percent and amount, VAT rate and amount | Sale facts with lines, from POS integrations; idempotent on external id                                                                                     | Engine, Integration | P2               |
| VAT modes: agency commission incl. VAT, agency ex VAT with margin, agency ex VAT invoiced, principal full VAT; store VAT calculator                        | The VAT treatment decision is open question 5. The engine freezes treatment per sale line together with its basis; the calculator is a tested pure function | Engine              | P2 (rule: owner) |
| Sale simulation endpoint (VAT + commission + net without persisting)                                                                                       | Same pure function exposed as a preview                                                                                                                     | Engine              | P2               |
| Receipts list, receipt detail with lines and seller net, search by external id, provider filter                                                            | Receipt read model; web list and detail; agent tool                                                                                                         | UI, Agent           | P2               |
| Returns and refunds; refund payout review flag ("needs review", mark resolved)                                                                             | Return as a fact that reverses the seller credit per open question 7; review flag when a payout already happened                                            | Engine              | P2               |
| Payment intents (kiosk/Stripe), sale confirm endpoint for kiosk                                                                                            | Not in core; POS owns checkout (decided). A kiosk is an integration calling the sale operation                                                              | Integration         | P5               |
| Economy dashboard: revenue, VAT, commission, net, receipts, returns, per period, currency normalisation                                                    | Weekly and monthly brief written by the agent from the same read model; one dashboard page                                                                  | Report, UI          | P3               |
| Zettle: pull purchases, push items and images, sync status, last sync, manual sync, auto-sync with lease                                                   | Zettle is the first POS (decided 2026-09-12): pull sales (P2), push accepted items (P3)                                                                     | Integration         | P2/P3            |
| Shopify and Shopify POS: webhooks, push items and inventory, pull sales, included categories, location                                                     | Shopify adapter after Zettle, same contract                                                                                                                 | Integration         | P3               |
| Square, Lightspeed provider names reserved                                                                                                                 | Same adapter contract; built on demand                                                                                                                      | Integration         | Later            |

### 3.6 Seller economy and payouts

| Earlier capability                                                                                                                                                         | New Komisio                                                                                                                                               | Form              | Phase |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----- |
| Seller balance (saldo): sales net minus payouts minus booking charges; min payout threshold; request payout from app; approve, mark paid, reject; notes; payment reference | Seller ledger, append-only; balance derived; payout request → approval (staff) → payment (rail) → confirmation; threshold as policy                       | Engine, Staged op | P2    |
| Payout rails: Swish payout (instruction, callback, retry), PayPal payout (batch, item, unclaimed), bank (manual with reference)                                            | Manual confirmation is a candidate first slice; Stripe investigation is owner-requested; Swish/PayPal depend on confirmed provider and store requirements | Integration       | P3    |
| Seller statement per period: opening balance, sales gross, commission, net, booking charges, payouts, closing; items and payouts listed; send by e-mail; shareable link    | Statement as a numbered immutable document (open question 10) generated from the ledger; delivery by e-mail and personal link                             | Engine, Report    | P2    |
| Settlement cockpit (balances per seller, outstanding, paid, per currency) and settlement wizard (draft payout from balance for a period, create payout)                    | One "settle" flow: the agent prepares a payout batch for all sellers above threshold; staff approves the batch                                            | Staged op, UI     | P3    |
| Payout confirmation and statement e-mails with templates                                                                                                                   | Notification through the communication log                                                                                                                | Engine            | P2    |

### 3.7 Store sections and bookings

| Earlier capability                                                                                                                                                                  | New Komisio                                                                                                                            | Form                | Phase |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----- |
| Sections with area, status, sort, metadata; layout editor (shapes, walls, building boundary, coordinates); batch create                                                             | Sections as a small register (the one register that stays, because it is physical); layout as a stored JSON document edited in the web | Engine, UI          | P4    |
| Pricing rules per section (day/week/month, effective dates, default fallback), batch pricing                                                                                        | Pricing policy per section                                                                                                             | Engine              | P4    |
| Booking: seller, period, per-day rows for collision, price breakdown, proration modes, status draft/confirmed/cancelled                                                             | Booking with atomic collision check and frozen quote (decided direction)                                                               | Engine              | P4    |
| Charge: pending/settled/cancelled/reserved for payout; collection modes POS-only or integrated; Swish and Stripe payment start and confirm; external payment; debt limit per seller | Charge as ledger entries; collection adapters are assessed separately from seller payout adapters; debt limit as policy                | Engine, Integration | P4    |
| Seller booking history and charges; concurrent booking limits                                                                                                                       | Read models on the ledger                                                                                                              | UI                  | P4    |

### 3.8 Accounting export

| Earlier capability                                                                                                                                                                                                                       | New Komisio                                                                               | Form        | Phase |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------- | ----- |
| Daily transfer per day: total sales, VAT on sales, commission, commission VAT, payout to sellers, payment method breakdown; regenerate                                                                                                   | Day close as a derived, immutable document per day (open question 6)                      | Engine      | P3    |
| Fortnox: OAuth per tenant, account mapping (sales, VAT, commission, payouts, bank/cash, Zettle and Shopify receivables), voucher preview, export with idempotency key and status history, reconciliation view, auto-export at a set time | Fortnox export extension: mapping, preview, export, reconciliation; idempotent; scheduled | Integration | P3    |
| QuickBooks and Visma OAuth stubs                                                                                                                                                                                                         | Same extension contract; on demand                                                        | Integration | Later |
| Additional accounting export target                                                                                                                                                                                                      | Same extension contract; select provider after requirements review                        | Integration | Later |

### 3.9 AI layer

| Earlier capability                                                                                                                                                                                                                                              | New Komisio                                                                                                                                                                                             | Form               | Phase                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------- |
| Unified LLM client with providers, retries, timeouts, circuit breaker, kill switch per tenant, PII sanitizer                                                                                                                                                    | Assistance adapters behind one port (done for reception); provider choice per feature; tenant allowlist becomes tenant policy; field minimization and reviewed destination policy before external calls | Engine             | Partial → P1         |
| Usage metering per tenant and feature, quotas, Stripe metered billing, usage page                                                                                                                                                                               | Attempt records exist (done); extend to units per feature, quota per tenant, monthly reset; billing mapping in P6                                                                                       | Engine             | P2                   |
| Prompt registry: versioned, per-locale, draft/active/retired, placeholders, rollback, admin UI                                                                                                                                                                  | Prompts are versioned code with a pinned hash (done); per-tenant tone and locale as placeholders; no admin UI                                                                                           | Engine             | Implemented baseline |
| Kompis chat (staff): inventory search, daily and weekly analytics, create article, update price, send notification; session history                                                                                                                             | Staff agent over MCP with read tools (done: queue, session, history, photos) and staged writes (done: propose review); analytics tools and price proposals next                                         | Agent              | P2                   |
| AI console: natural-language bulk edits producing a reviewable change set (find entities, propose, describe, apply, reject, history; quick actions: adjust prices, deactivate inactive sellers, fix categories)                                                 | Same as staged operations: the agent proposes a change set as one pending operation with a preview; approve or reject; history is the operations queue (done for reviews)                               | Staged op          | P2                   |
| Copilot dock: page-aware, text and voice, 19 tools (find items/sellers/payouts, summaries, tenant stats, unfinished setup, navigate, update price, mark payout paid, toggle seller active, propose change set), confirmation cards, audit per tool call, quotas | Web copilot as a thin client over MCP: the same tools, page context injected, confirmation is the staged-operation approval                                                                             | Agent, UI          | P4                   |
| Voice onboarding assistant (realtime API, ephemeral tokens, minutes quota)                                                                                                                                                                                      | Voice as an adapter on the copilot, after text works                                                                                                                                                    | Agent              | P5                   |
| Public Kompis: anonymous buyer chat on the webshop with rate limits, suggested items                                                                                                                                                                            | Buyer assistant over the public read model, rate-limited, tenant-scoped                                                                                                                                 | Agent, Integration | P5                   |
| Vision service: image → type, condition 1–5, price suggestion, tags, dimensions                                                                                                                                                                                 | Sourced suggestion contract implemented; live vision unverified; condition scale and tags are future contract decisions                                                                                 | Engine             | Implemented baseline |
| Visual similarity pricing (in-store and cross-store anonymised comparables, opt-in)                                                                                                                                                                             | Price evidence adapter: comparable sales in the store first; cross-store later with explicit opt-in                                                                                                     | Agent              | P3                   |
| AI agent log (action, input, output, confidence, escalation)                                                                                                                                                                                                    | Operations and access events (done)                                                                                                                                                                     | Engine             | Implemented baseline |
| Seller pricing coach, inventory insights brief, markdown agent, taxonomy normalisation, seller quality scoring, fraud detection (proposed, partly built)                                                                                                        | Insights brief (P3), markdown agent (P3), pricing coach in seller app (P4); quality scoring and fraud as later agents                                                                                   | Agent              | P3–P5                |

### 3.10 Printing and labels

| Earlier capability                                                                                                                                                                                                                                               | New Komisio                                                                                                                                                                                                                     | Form                | Phase |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----- |
| Printers register (path, IP, port, model, DPI, type), labels register (ZPL with placeholders), printer-label bindings with events (bag on intake, item, shelf, storage, pickup, donation/return, quality, transfer, shipping, markdown), automatic print on save | One label engine: four templates on day one (bag, item, onboarding slip, markdown; decided 2026-09-12), a printer list per store (the second small register), print requested by the engine on events; ZPL rendered server-side | Engine, Integration | P2    |
| Print service (local Windows service on port 8080, USB and TCP)                                                                                                                                                                                                  | Keep the idea, rebuild as a small local agent that polls or receives print jobs from the hosted service; USB and TCP; signed release asset                                                                                      | Integration         | P2    |
| Bulk reprint, printing details for the mobile app                                                                                                                                                                                                                | Engine operations                                                                                                                                                                                                               | Engine              | P2    |

### 3.11 Buyer-facing

| Earlier capability                                                                                         | New Komisio                                                                                                | Form  | Phase |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----- | ----- |
| Mobile browse of items in store by tenant, item detail, change store, test access code for unlisted stores | Public read model per store; seller app and web page share it; test-code gating as store visibility policy | UI    | P4    |
| Public Kompis                                                                                              | See 3.9                                                                                                    | Agent | P5    |

## 4. What is dropped, and what replaces the outcome

| Dropped                                                                                           | Why                                                                                                                                      | The outcome is served by                                         |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Category, product, dimension registers and their admin UIs, help pages and quick-start generation | Reduce manual maintenance where measured classification and reviewed mappings preserve the outcome                                       | Sourced facts on the item; adapter-side mapping for integrations |
| VAT rate register per country                                                                     | No VAT representation is selected yet; approved treatment needs effective dates, evidence and deterministic validation                   | Approved engine policy, pending question 5                       |
| Labels, printers, printer-label bindings, events as four separate registers                       | One label engine with built-in templates and a printer list                                                                              | 3.10                                                             |
| Translations admin, tenant info page CMS, agreement translations                                  | Generated informational text is reviewed as needed; agreement translations must be exact published versions, never live substituted text | 3.1                                                              |
| Prompt registry admin UI                                                                          | Prompts are code with tests                                                                                                              | 3.9                                                              |
| AI console as a separate surface                                                                  | Staged operations are the one review surface for every agent write                                                                       | 3.9                                                              |
| Books demo module, page-visit tracking, application package storage in the database               | No product value                                                                                                                         | –                                                                |
| Host billing UI (preview, defaults, invoices, overview)                                           | Two tiers; Stripe owns invoices                                                                                                          | 3.1                                                              |
| Onboarding badges and gamification                                                                | Onboarding is a conversation with a checklist                                                                                            | 3.1                                                              |
| Kiosk payment intents                                                                             | POS owns checkout                                                                                                                        | 3.5                                                              |

## 5. AI-first operating model

The earlier system had five separate AI entry points with five tool sets. The
new Komisio shares one engine contract: an agent can use MCP, with read tools
and staged-write tools, and every surface (web copilot, mobile assistant,
voice, scheduled jobs) is an adapter to that contract. Internal adapters need not
make an MCP network round trip to call the engine. The tool catalogue,
derived from the earlier copilot, console, chat agent and onboarding
assistant, is:

| Group        | Read tools                                                                                                                 | Staged-write tools                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Store        | get store state, list unfinished setup, get stats for a period, search help                                                | set policy, complete onboarding step                                                                                    |
| Sellers      | find sellers, get seller summary, get statement                                                                            | register seller, update contact, toggle active, send message                                                            |
| Intake       | list receptions, read reception, read history, read photo, read exact staged operation, duplicate check, identify by image | propose review (done), propose batch reception, propose acceptance                                                      |
| Items        | find items, get item summary, search by meaning, price evidence                                                            | propose price change, propose markdown batch, propose lifecycle action (extend, donate, return), regenerate description |
| Sales        | find receipts, get receipt, simulate sale                                                                                  | record return                                                                                                           |
| Economy      | get balances, get payout summary, find payouts, day close preview                                                          | propose payout batch, mark payout paid, export day close                                                                |
| Bookings     | availability, quote                                                                                                        | propose booking, settle charge                                                                                          |
| Integrations | sync status, test connection                                                                                               | run sync, propose import mapping, commit import                                                                         |

Rules that apply to every tool: tenant is pinned by the host, never chosen by
the model; reads carry `evidenceIsUntrusted`; proposed writes return
`staged:true, executed:false`; risk level derives from the kind; medium and
high kinds require a different authenticated approver identity, not merely a new session; owner-enabled
auto-execution would require its own reviewed capability design (none exists today).
Provider adapters must minimize outgoing fields and assess redaction, retention
and destination policy. A text sanitizer cannot guarantee removal of personal
data from images or free text. The hosted connector (2026-09-16, [HOSTED-MCP.md](HOSTED-MCP.md))
is the delegated, scope-limited credential: a member approves an assistant for one
store on a consent page and every call runs as that person; see [MCP scope and limitations](../mcp/README.md).

## 6. Surfaces after the change

| Surface                     | Contains                                                                                                                                                                        | Does not contain                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Web (staff)                 | Approvals queue, reception, bag receipts, lifecycle queue, receipts and returns, payouts and settlements, bookings planner, store settings, integrations status, statements     | Registers, AI console, prompt admin, billing admin, translations |
| Seller app (mobile and web) | Store picker, register, agreement, create handover (bag or box with QR), my items with stage and days left, balance and payout request, statement, notifications, pricing coach | Staff functions                                                  |
| Staff mobile                | Reception with camera, identify by image and AR price, scan label, print                                                                                                        | Admin                                                            |
| Copilot (web, later voice)  | Conversation over the tool catalogue with page context                                                                                                                          | Its own write path                                               |
| Public page per store       | Browse, price feed, buyer assistant                                                                                                                                             | Anything seller-specific                                         |
| Local print agent           | Receives print jobs, drives USB or TCP printers                                                                                                                                 | Business logic                                                   |

## 7. Phases

Phases are proposals, not dated promises. Split each into small verified journeys.
Nothing financial is implemented before its question is answered. Before any
external pilot, verify identity/recovery and invitation flows, tenant isolation,
backup/restore, privacy/retention and export/support procedures, plus a complete
authenticated hosted journey. These gates are not deferred to P5.

The descriptive draft-to-reception preview is delivered in PR50: it compares the
saved draft with the sourced review contract without creating an item, recording
custody, changing terms or publishing. Explicit per-fact review followed in PR51;
PR54 narrowed the shared assistance evidence port and PR55 added scoped operation
discovery. These are bounded parts of the phases below, not completed P1/P2 phases.
Current evidence is in DEVELOPMENT-HANDOFF.md. Acceptance design still requires
resolution of convergence and terms questions.

Status 2026-09-13 (Fable, lead architect): P1 is on main and staging: store
policy with VAT modes and assistance flag, seller terms, garment custody,
purchases, acceptance from three origins with frozen terms and provenance,
policy-aware reception queue, staged agent acceptance with a second-person
approval, mobile custody and acceptance journey, scan-to-open. P2 engine slices
delivered as PRs: VAT arithmetic, sales with frozen lines, seller ledger,
payouts, returns, settlement statements, day closes, seller communication log
with e-mail transport, lifecycle work list with markdowns, four label
templates with the local print agent, usage metering with a policy quota,
staged agent kinds for returns, ledger adjustments, markdown batches, bulk
item updates, payout transitions and template-bound messages with MCP
proposers, automatic seller notifications behind a policy switch, and the
SIE 4 export of day closes under a tenant-published account map. Astra then
delivered the seller economy portal with seller payout requests, browser
journeys for the P2 surfaces, batch reception and the Zettle pull behind
fixtures with the staged kind `recordZettlePurchase`. Still open in P2: the
live Zettle connection (needs tenant credentials), sending vouchers through
the Fortnox API (needs a connected account), duplicate check (design note
first), USB print transport (needs hardware). From P3, the settlement batch
is delivered: `settle_payouts` requests and approves a payout for every
listed seller in one transaction, `settlement_candidates` lists who is due,
and the staged kind `settlePayouts` lets an agent propose the batch; and
the economy overview: `economy_summary` computes any period with the day
close's sums, shown on `/intake/economy` and readable by agents through
`komisio_read_economy_summary` (migration `20260915110000`, see
[ECONOMY-OVERVIEW.md](ECONOMY-OVERVIEW.md)); the weekly and monthly brief
is a deterministic rendering of that read for one calendar period and the
one before (`economy_brief`, migration `20260915230000`, on the economy page
and as `komisio_read_economy_brief`); and the store
profile: one versioned public document per store with an anonymous read by
slug, the staged kind `updateStoreProfile` and MCP tools under `store:read`
and `store:propose` (migration `20260915120000`, see
[STORE-PROFILE.md](STORE-PROFILE.md)). Pilot gates delivered as far as code can take them: the tenant
isolation sweep, the seller data export and the restore exercise (migration
`20260915130000`, see [PILOT-GATES.md](PILOT-GATES.md)); retention policy,
hosted point-in-time recovery and storage backup remain owner actions. Self drop-off delivered: seller handovers with a reference, received
at the counter as the ordinary bag receipt, behind the policy's
`seller_dropoff` custody source (migration `20260915140000`, see
[SELF-DROPOFF.md](SELF-DROPOFF.md)); locker hardware and QR rendering follow. Markdown agent delivered after the owner answered question 4: the policy
schedule stays the only one, `automaticMarkdowns` applies due steps daily as
the policy's publisher, staff can run the same step by hand, every run is
recorded (migration `20260915150000`, see
[MARKDOWN-AGENT.md](MARKDOWN-AGENT.md)). One currency per store delivered
after the owner's decision: the policy names it, money facts record it, it
freezes after the first sale, purchase or payout (migration
`20260915180000`, see [STORE-CURRENCY.md](STORE-CURRENCY.md)). Price evidence from the store's own sales delivered as a read, a panel
on the inspection and reception pages and an agent tool (migration
`20260915200000`, see [PRICE-EVIDENCE.md](PRICE-EVIDENCE.md)); cross-store
evidence waits for an opt-in design
(migration `20260915100000`, see [SETTLEMENT.md](SETTLEMENT.md)).

On 2026-09-14 the Fortnox chain closed: a per-store connection with sealed
tokens and a company pin (migration `20260915210000`), voucher sending from
recorded exports (`20260915220000`), the reconciliation view
(`20260915240000`) and the accounting page in three views; the first real
voucher reached the owner's Fortnox test company. The weekly and monthly
brief is a deterministic read (`20260915230000`). The owner's decisions on
the consolidated list ([OWNER-ACTIONS-2026-09-14.md](OWNER-ACTIONS-2026-09-14.md))
pulled parts of P4 and P6 forward: the automation actor (`20260916020000`,
[AUTOMATION-ACTOR.md](AUTOMATION-ACTOR.md); Astra's scheduled Zettle
retrieval runs on it), plans and trial with a read-only gate
(`20260916030000`), Stripe Checkout, portal and webhooks
(`20260916040000`), trial notices from a daily cron (`20260916070000`) and
the onboarding checklist, all in
[ONBOARDING-AND-PLANS.md](ONBOARDING-AND-PLANS.md) and verified end to end
on staging. The client got a grouped navigation, a start page with today's
numbers, a mark, and a sellers list. The seller duplicate check is
delivered as a read shown at registration (`20260916220000`,
[DUPLICATE-CHECK.md](DUPLICATE-CHECK.md)); exact photo repeats are
detected by content digest (`20260916230000`); similarity by model waits
for the assistance provider. The host page shows usage counts per store
(`20260916240000`). The staff agent can find items by text and stage and
read one item's summary, and find and read receipts, under the read scopes
`items:read` and `sales:read` (`20260916250000`,
[AGENT-ITEM-READS.md](AGENT-ITEM-READS.md)); the same read gives the items
page its search. A price proposal per item is `komisio_propose_price_change`: it cites the price evidence it read, is refused when the citation is stale, and stages the existing bulk update at medium risk. Chains (step 1 of [CHAIN-GROUPING.md](CHAIN-GROUPING.md)): an owner groups the stores it owns under one company name, and owners or admins of every store read the per-store numbers and their total on the economy page (`20260916260000`); an owner or admin of both stores moves a consignment item to another store in the chain: ended here with reason transfer, received there as a bag with one draft, accepted under the target's own terms (`20260916270000`). The stock report gives margin, sell-through and stock age per category (`20260916280000`, [STOCK-REPORT.md](STOCK-REPORT.md)). The Shopify adapter has the per-store connection (`20260916290000`, [SHOPIFY-ADAPTER.md](SHOPIFY-ADAPTER.md)) products out with revision-bound token renewal (`20260916320000`) paid orders in as sales or held orders (`20260916330000`, verified against the dev shop on 2026-09-15) a scheduled pull every quarter hour on the automation identity (`20260916340000`), refunds as returns and the reception photo as product image (`20260916350000`). The Shopify adapter is complete for the pilot. Quick reception (one screen per garment, policy profile `intakeProfile`, `20260916360000`, [QUICK-INTAKE.md](QUICK-INTAKE.md)) is the default intake; the navigation rework into five work areas follows. The production path is code-complete: the environment guard accepts `production` with a production shape and the owner-dispatched, owner-approved `Production database` workflow applies migrations ([PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md) lists the owner steps P1 to P14). The import wizard starts with sellers from a CSV as one staged operation (`20260916300000`, [IMPORT.md](IMPORT.md)). The partner API is a proposal with owner questions ([PARTNER-API.md](PARTNER-API.md)). The seller portal shows the seller's own items with price, state and period end (`20260916310000`). What remains before production is the checklist in
that document and the pilot gates; what remains of P3 needs the owner
(payout rails, printer) or Astra's list (automatic Fortnox sending,
retention and erasure).

| Phase                                       | Theme                    | Slices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Needs from owner                                                                                                                        |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P0 (implemented baseline; pilot gates open) | Foundation and reception | Tenancy, users, MFA, agreements, bag receipts, inspection drafts, single-garment reception with optional AI adapter, seller mobile review, staged operations, MCP reads and propose                                                                                                                                                                                                                                                                                                                                             | –                                                                                                                                       |
| P1                                          | Accept and hold          | Tenant policy table (commission basis, agreement prerequisite, custody source, per-item seller review on/off, sale period, markdown steps, end-of-period action), custody event for garments, commercial acceptance command creating items from three origins (inspection draft, reception review, purchase) with the four terms frozen per item, purchase registration for store-owned items, per-seller commission flag, item events, price series, staff mobile reception, per-fact AI confirmation, unified assistance port | Answered 2026-09-12 (questions 2, 3; ADR A1–A4)                                                                                         |
| P2                                          | Sell and settle          | Zettle sales pull, sale lines with VAT freeze for consignment and store-owned items, returns, seller ledger and balance, payout request/approve/pay (manual rail), statements, four label templates and the local print agent, lifecycle queue, batch reception, duplicate check, e-mail notifications, communication log, usage metering, staff agent tools (analytics, price proposals), bulk staged ops                                                                                                                      | Answered 2026-09-12 (questions 5 to 13); VAT cases still to be verified against Skatteverket before they become rules. See P2-SLICES.md |
| P3                                          | Run the store            | Markdown agent with policy, day close and Fortnox export, Swish and Stripe payout rails, settlement batch, insights brief, visual pricing evidence, Shopify adapter, self drop-off handover with QR, store profile                                                                                                                                                                                                                                                                                                              | Question 4 (markdown policy shape); the rest answered 2026-09-12                                                                        |
| P4                                          | Bookings and assistants  | Sections, layout, pricing rules, bookings and charges; web copilot over MCP; onboarding conversation; multilingual descriptions; semantic search; identify by image and AR; public browse; pricing coach                                                                                                                                                                                                                                                                                                                        | Booking fee questions                                                                                                                   |
| P5                                          | Open up                  | Partner REST subset with OAuth clients, import wizard as staged op, kiosk integration contract, voice adapter, public buyer assistant, self-service export automation, quality and fraud proposals, multi-tenant provider connections (Zettle and Fortnox per store with sealed credentials, rotation, revoke; reuse `lib/platform/credentials.ts`)                                                                                                                                                                             | –                                                                                                                                       |
| P6                                          | Commercial               | Hosted tier subscription in Stripe, AI quota mapping, operator report                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pricing decisions                                                                                                                       |

### Explicit P5 slice: multi-tenant Zettle connections

Replace the single pilot environment credential slot with partner-hosted
authorization and tenant-bound encrypted credential storage, rotation and
revocation. Preserve merchant verification, tenant isolation, server-only secrets
and immutable connection provenance. This is planned work, not delivered by the
pilot binding. Scheduled receipt retrieval remains a separate follow-up using
the enabling owner/admin identity and a database-owner-only pg_cron entry point;
do not introduce a service-role client or reuse a staff click as a worker actor.

## 8. Questions this document raised

Answered by the owner on 2026-09-12 and recorded in DECISIONS.md: the hourly
price-decay concept is outside version 1; four label templates on day one (bag,
item, onboarding slip, markdown); store-owned items are in the first sale slice;
Zettle is the first POS; sellers are notified by e-mail first, push later. Which
messages need fixed wording is decided per template when the notification
policy is built (P2): the model writes inside a fixed, store-editable template.

## 9. Coverage accounting

Counting capabilities, not screens. Capability rows in section 3: 80, after
the owner excluded the hourly price-decay concept and its price screens.

| Treatment                                                           | Rows | Meaning                                                                                                           |
| ------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| Recreated in the same form (engine, UI, integration)                | 48   | Same outcome, same kind of surface                                                                                |
| Transformed (agent, staged operation, report, operations procedure) | 31   | Same outcome, reached through a conversation, an approval or a generated report instead of a register or a screen |
| Dropped without replacement                                         | 1    | Page-visit tracking and in-database application packages                                                          |

The inventory proposes retaining outcomes for 79 of 80 rows. This measures
the proposal, not implementation coverage, verified quality or an owner
commitment to build 99 percent of the legacy product. The registers and admin
surfaces listed in section 4 are inside the transformed rows, each with what
replaces it, so a reader can dispute any single row. Not counted: the books
demo module, which had no product function.

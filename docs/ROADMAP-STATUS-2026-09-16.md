# Roadmap status at the production launch, 2026-09-16

Written by Fable on the day production opened (`app.komisio.com`), at the
owner's request, as the reading of [FUNCTIONAL-ROADMAP.md](FUNCTIONAL-ROADMAP.md)
against what is on main. Phase names follow section 7 of the roadmap.
"Delivered" means merged with tests and on staging; production runs every
migration up to `20260916460000` and gets the rest with the next dispatch.

## What production has today

| Phase | Delivered on main                                                                                                                                                                                                                                                                                                                                                                                                                               | Not delivered (from the phase's slice list)                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | Tenancy, four roles, invitations, TOTP MFA, seller agreements with evidence, bag receipts, inspection drafts, single-garment reception with the assistant, seller mobile review, staged operations with risk levels, local MCP reads and proposals                                                                                                                                                                                              | Nothing material                                                                                                                                           |
| P1    | Store policy (commission, VAT modes, custody, sale period, markdown steps, end action, assistance switch), garment custody, purchases, acceptance from three origins with frozen terms, policy-aware reception queue, staged agent acceptance with second-person approval, mobile custody and acceptance, scan-to-open, quick one-screen reception as the default intake profile                                                                | Nothing material                                                                                                                                           |
| P2    | Zettle live (products out, receipts in, scheduled pull on the automation actor), sale lines with frozen VAT, returns, seller ledger and balance, payout request/approve/pay (manual rail), statements, label templates and sizes per kind, Komisio Print (paired Windows service, Zebra over the network), ZPL editor with preview, lifecycle queue, batch reception, duplicate checks, e-mail notifications, communication log, usage metering | USB print transport (needs hardware)                                                                                                                       |
| P3    | Markdown agent with policy, day close and SIE 4, Fortnox connection, voucher sending, reconciliation and scheduled sending, settlement batch, economy overview, weekly and monthly brief, stock report, price evidence, Shopify (products out, orders and refunds in, scheduled), self drop-off handover, store profile, chains with transfers between stores, seller import                                                                    | Swish and Stripe payout rails (payouts are marked paid by hand); QR rendering for the drop-off locker                                                      |
| P4    | Hosted MCP connector to the store's own assistant (Claude, ChatGPT) with OAuth and consent; onboarding checklist                                                                                                                                                                                                                                                                                                                                | Web copilot, onboarding conversation, multilingual descriptions, semantic search, identify by image, sections/bookings, pricing coach                      |
| P5    | Multi-tenant Fortnox, Shopify and Zettle-per-store connections with sealed credentials; seller import wizard (first slice); scheduled provider retrieval on the automation actor                                                                                                                                                                                                                                                                | Partner REST subset with OAuth clients, kiosk contract, voice adapter, public buyer assistant, quality and fraud proposals, self-service export automation |
| P6    | Open core and AI credits (included monthly credits, packs through Stripe, own OpenAI key, platform cap), host settings and showcase, public pricing endpoint, plans/trial/Stripe subscription machinery kept dormant                                                                                                                                                                                                                            | Operator report as a document (the host page shows usage; no generated report)                                                                             |

Cross-cutting, delivered today or this week: eight product languages
(PR 210), production environment and CLI deploy after the database
(PRODUCTION-CHECKLIST.md), free and open pricing on the site.

## Pilot gates and production checklist

[PILOT-GATES.md](PILOT-GATES.md) "still open", read against today:

| Gate                                            | Status                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Retention policy and erasure for seller contact | Open (P14). Erasure function exists; the policy text and the procedure are the owner's.                                                      |
| Storage object backup on the hosted project     | Owner to confirm in the Supabase dashboard for the production project.                                                                       |
| Point-in-time recovery                          | Done (PITR 7 days on production).                                                                                                            |
| pg_cron and the two schedules                   | Done: enabled on production 2026-09-16, `komisio-automatic-markdowns` and `komisio-expire-plans` active.                                     |
| Complete authenticated hosted journey           | The owner registered and is host; a full smoke journey (P13: bag, accept, print, sale, payout, day close) is not yet recorded on production. |
| Synthetic MFA recovery exercise                 | Open (P12).                                                                                                                                  |
| Deploy ordering                                 | Done for production (CLI deploy after migrations). Staging still deploys on push.                                                            |
| Stripe                                          | Open: live keys and the credit price ids per currency (Astra).                                                                               |
| `CRON_SECRET`                                   | Done for production.                                                                                                                         |

Also open on the checklist: P7 (Fortnox, Shopify, Zettle registered with
production callback URLs), P11 (the legal texts are on the site branch;
publish them) and dedicated tokens instead of the owner's personal ones in
GitHub. Komisio Print for production was published on 2026-09-17 as
`print-v1.0.1`, carrying both packages; printing to physical hardware is still
unproven and needs a printer.

## What the roadmap still holds after the launch

In the order Fable would take them, with the reason:

1. **Open registration in practice.** Delivered 2026-09-16: the allowlist
   accepts `*` and the engine caps messages and invitations per store and
   day. The owner sets the two variables on production (A18).
2. **The AI assistant against a real model.** The credits model is built,
   tested and advertised, but no hosted environment has an assistance
   provider configured, so no call has ever been made (A19). This is the
   largest gap between what the product page promises and what runs.
3. **Payout rails (P3).** Swish through the store's own bank agreement,
   without a service fee; Stripe as the second rail. Today every payout is
   marked paid by hand, which is the most visible manual step for a store.
4. **Hosted MCP: the remaining 18 tools.** Their engine reads use table
   access; move them to SQL functions so the store's own assistant sees
   receipts, seller ledgers and reception details too (HOSTED-MCP.md).
5. **Verified identity (P0 gate "identity").** Unsolved and unpromised. Each
   market has its own scheme and the providers charge per use, so nothing is
   committed until a market needs it and the cost is known.
6. **Web copilot (P4)** on the same tools and credits as the connector, and
   the onboarding conversation that replaces the checklist.
7. **Search and descriptions (P4).** Semantic search, descriptions per
   language, identify by image; these need the assistance provider and the
   credits model, both now in place.
8. **Partner REST subset with OAuth clients (P5).** The connector's OAuth
   server already exists; the REST layer is the remaining piece.
9. **Sections, bookings and charges (P4)**, kiosk contract and public buyer
   assistant (P5): the parts of the legacy product with no counterpart yet.
10. **Operator report (P6)** generated from the host data.

## What is deliberately not on the list

Hourly price decay and its screens (owner, 2026-09-12), page-visit tracking
and in-database application packages (dropped without replacement), the
mobile app for staff (the web works on the phone), and any AI action that
executes without a person's approval or a rule the store set.

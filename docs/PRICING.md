# Pricing: free and open, AI credits metered

Owner decision 2026-09-16, delivered by Fable in migration `20260916440000`.
It replaces the plan models of the two previous days: there is no plan, no
cap and no paid package. Komisio is free and open source, also when Inority
hosts it. The only thing that is metered is the AI assistant's model usage
when it runs on the host's own key.

## The offer, as the store sees it

- Everything is included: reception, items, sales, returns, markdowns, day
  close, settlements, payouts, statements, exports, Zettle, Shopify, Fortnox,
  chains, label printers, the seller portal, staff, the hosted MCP connector
  to the store's own assistant. No limits on items, printers or integrations.
  Swish payouts run through the store's own bank agreement without a service
  fee from Komisio.
- AI credits: one credit is one krona. A store on Inority's hosting gets 100
  credits a month included. The assistant's calls are paid from them at the
  model's actual token cost (a few öre per garment). When they are used up,
  the store buys 100 more for SEK 100, or connects its own OpenAI key and is
  never metered again. Self-hosted installations meter nothing.
- The hosted MCP connector costs nothing: the store's own assistant (Claude,
  ChatGPT) pays its own tokens to its own provider.

## The text for the product page

Proposed wording (Swedish first, the owner edits before publishing):

> Komisio är gratis och öppen källkod. Inority driftar lösningen åt butiken
> helt gratis. Det ingår AI-funktionalitet för cirka {items} varor per
> månad. Slår du i taket köper du 100 nya AI-krediter för 100 kr, eller
> kopplar enkelt Komisio till ditt eget abonnemang hos Claude eller ChatGPT.
>
> Så här mycket betalar butiker som kör Komisio skarpt idag:
> {for each listed store: "{label}, tar emot cirka {itemsPerMonth} varor per
> månad: {cost} kr per månad för Komisio."}
>
> Jämför med konkurrenternas system som kostar från 699 kr/mån och uppåt.

Every number in that text comes from `GET /api/public/pricing` (no session,
cached ten minutes):

| Field                    | Source                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `includedOre`, `packOre` | The host's platform settings                                                                                                 |
| `estimatedItemsPerMonth` | Included credits divided by the measured average cost per assistant call over the last ninety days (once twenty calls exist) |
| `measured`               | Whether that average is measured or still the configured estimate                                                            |
| `stores[]`               | The stores the host listed under Plattform, with their label, items accepted in the last thirty days and credits bought      |

The figures are real or absent. Until stores run live, the page shows the
configured estimate and no store list; an invented example is not published.

## Where the rules live

- `platform_settings` (one row): `ai_credits_enabled`, `ai_monthly_cap_ore`,
  `ai_included_ore`, `ai_pack_ore`, the reservation per call and the model's
  öre per million input and output tokens. The host edits them under
  Plattform; `set_ai_platform_settings` writes them.
- `ai_credit_events` (append-only): `included` once a month per store,
  `purchased` once per Stripe event, `reserved` before a model call (the
  estimate, negative) and `settled` after it (the correction to the actual
  token cost). `funded_by` says whether a call drew on included credits,
  purchased credits or ran on the store's own key.
- `reserve_reception_assistance` refuses with `AI_CREDITS_EXHAUSTED` when the
  store has neither included nor purchased credits left, and with
  `AI_CAP_REACHED` when the platform-wide cap on included spend is reached and
  the store holds no purchased credits. A refused call leaves no attempt and
  no row. `settle_reception_assistance` records the actual cost; a failed
  call settles at zero, which releases the reservation.
- The platform cap counts only calls funded by included credits: purchased
  credits are money the store paid, so they never stop at the cap. The host
  sees `capUsedOre` for the month under Plattform.
- `ai_connections` holds a store's own key sealed with `KOMISIO_CREDENTIAL_KEY`
  (the same envelope as Shopify and Fortnox tokens); `ai_connection_cipher`
  hands the box to the run, which opens it in the application. A store with
  its own key runs on it and no credits move.
- `record_ai_credit_purchase` is called by the billing actor from the Stripe
  webhook (`checkout.session.completed`, mode `payment`, metadata
  `kind=ai_credits`), once per event id.
- `public_pricing()` is the only anonymous read; it returns aggregates and
  the host's labels, never a store id or a person.

## Verification

- pgTAP `0112_ai_credits` (32 assertions): included grant, reservation and
  settlement to the token cost, exhaustion with no attempt written, purchases
  once per event and only by the billing actor, purchased credits under the
  cap, own key never metered, everything ungated, public pricing and the
  showcase.
- pgTAP `0110_open_core`: an ended trial changes nothing; 101 items, two
  devices, Shopify and a chain on a store without a subscription; read-only
  still holds.
- Unit tests in `tests/unit/ai-credits.test.ts`; `npm run test:mcp` covers
  the connector without a plan gate.

Not verified: a live assistant call settling against staging (needs the
host switch and `STRIPE_CREDITS_PRICE_ID`, owner action A16).

## Later

- A second provider (Anthropic) for the store's own key.
- BankID sign-in as a paid add-on (SEK 49 a month) once an eID broker is
  chosen; Swish payouts stay free.
- A hosted copilot on the same credits.

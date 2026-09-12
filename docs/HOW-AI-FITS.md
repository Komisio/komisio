# How AI fits into Komisio

Komisio's core remembers what happened and controls what is allowed. AI proposes
what could happen next. The web interface, a future camera station and an AI host
are different ways to work with that same core.

## Follow one jacket

1. A reception session identifies the store and seller. Photos and observations
   become versioned sources. A session does not by itself prove physical custody.
2. Optional AI reads the supplied evidence and proposes garment metadata. A price
   must cite supplied price evidence; a photograph alone is not market data.
3. Staff checks the result and the store's exact terms. Publishing creates a new
   immutable review. It is distinct from generating or previewing suggestions.
4. The intended seller signs in and opens their personal link. They see that
   review's description, price, terms and pinned photos, then approve or decline.
5. The core saves the response to that exact version. A changed source snapshot,
   replaced review or revoked link cannot silently reuse the earlier approval.

Commercial acceptance, POS publication, commission and payout are separate future
operations. Seller approval here does not execute any of them.

## Where things belong

| Responsibility | Current home | Why |
| --- | --- | --- |
| Identity, store access, exact versions and saved decisions | `supabase/migrations/` and `lib/engine/` | Must work even if a model gets something wrong |
| Descriptive proposal shape and source validation | `lib/engine/reception.ts` | Shared by manual input, built-in assistance and MCP |
| Model credentials, runtime prompt, provider call and attempt limits | `lib/assistance/` | Replaceable and optional, with bounded cost/execution |
| Photo bytes | Private Supabase Storage buckets | Photos are evidence, not files in Git or skills |
| Image decoding and minimization | `lib/media/` | Same handling for capture, inference and image delivery |
| Staff and mobile interaction | `app/` and `components/reception/` | Thin callers of shared operations |
| Local external AI tools | `mcp/` | Explicit read/image/preview scopes using the same engine |
| Domain guidance | `skills/` | Reviewed instructions and unresolved questions |
| Accepted rules and rationale | `DECISIONS.md` and database tests | A prompt alone cannot enforce a rule |

Some fixed data is necessary: which store owns a session, which source version
was reviewed, who responded and which terms they saw. These cannot disappear into
a model conversation. Descriptive metadata can remain a small validated proposal
contract; it does not require copying the old catalogue, VAT and item lifecycle.

Skills currently guide development and domain reasoning. The running provider
uses a reviewed, versioned prompt in its adapter; it does **not** automatically
read every Markdown skill at request time. Editing a skill is therefore not a
runtime policy change. Identity, permissions and financial invariants must always
be enforced by code/database independently of those instructions.

## Two ways to use AI

**Built-in assistance:** the application calls an explicitly configured provider
for an allowlisted store. Suggestions are transient and require staff review.
Without configuration the UI says AI is unavailable and manual work continues.
See [configuration and limits](RECEPTION-ASSISTANCE.md).

**An external AI host:** the local MCP server can read a known session, optionally
read a minimized photo, and validate an unsaved preview. The host chooses and
pays for its model. It cannot publish, issue a seller link or approve for a seller.
There is no durable pending-operation queue or hosted OAuth yet. See
[MCP setup and boundaries](../mcp/README.md).

These are implemented boundaries, not a claim that arbitrary agents are safe.
Text and pixels remain untrusted evidence, and a model can still misidentify a
brand, size, condition or price. Human review remains part of the pilot.

## What can change later

A new model plugs into the assistance contract. A camera station can eventually
submit bounded captures against a correctly paired session. A redesigned UI calls
the same operations. Those changes need not rewrite seller identity or historical
decisions. Camera pairing, hosted delegation and agent write approval still need
their own authorization and tests before activation.

This follows the shared-engine and staged-operation direction fixed in
`ARCHITECTURE.md`. The [reception ADR](RECEPTION-ARCHITECTURE.md) records the
actual scope and trade-offs.

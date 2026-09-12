# Optional reception assistance

The first concrete provider is an optional OpenAI Responses adapter. It consumes
the same saved reception sources as manual preparation and returns the existing
typed proposal. No provider credential is part of the core or browser bundle.
The current staging installation has no model configuration; it truthfully shows
unavailable. Test fixtures do not demonstrate live model quality or account access.

## Enable deliberately

Apply `20260912022000_reception_assistance.sql` before deploying this version.
Supply these server-only settings in the intended deployment:

- `KOMISIO_RECEPTION_AI_PROVIDER=openai`
- `KOMISIO_RECEPTION_AI_KEY`: a separate provider project key
- `KOMISIO_RECEPTION_AI_MODEL`: an explicit model ID with image input and strict
  Structured Outputs support; there is no hard-coded model default
- `KOMISIO_RECEPTION_AI_TENANTS`: exact comma-separated store UUIDs, no wildcard

Missing/invalid configuration or an unlisted store is unavailable. A generic
`OPENAI_API_KEY` is never inherited. Configure provider-side spend limits and
evaluate representative garment/label/defect examples before enabling a real
pilot. The 199 SEK product tier has no decided model allowance or billing mapping.

## Evidence and boundaries

`lib/assistance/openai-reception.ts` translates the provider wire format into
Komisio's provider-independent contract. Runtime instructions are versioned
`reception-v1` code; `skills/garment-reception/SKILL.md` is workflow guidance for
agents and people, not an automatically executed permissions file. Changing a
skill cannot change RLS, price validation or seller authority. A unit test pins
the exact prompt text to its version: changing the wording requires a new
version, an additive migration that accepts it in the attempt reservation, a
skill review and a new pinned hash, so two prompts never share one version in
the attempt history.

The shared port minimizes evidence before invoking any provider adapter and marks
all returned descriptive facts tentative after strict validation. Internal tenant,
session and seller identity, revision and photo Storage references stay with the
orchestrator. See [port contract](RECEPTION-EVIDENCE-PORT.md). This is an application
boundary, not a sandbox for untrusted in-process provider code.

The provider receives source IDs, descriptive observations and supplied price
evidence, plus up to three reduced images. Seller/session/store identifiers,
account information and Storage paths are excluded. Free text and visible pixels
can still contain personal information: the operator must select garment evidence
without it. No face identification or automatic redaction is implemented.

Sharp decodes JPEG/PNG under a 20-megapixel limit, auto-orients, resizes to fit
1536 by 1536 pixels and emits a JPEG derivative of at most 1 MiB without embedded
EXIF/XMP/ICC metadata. Originals remain immutable in private Storage. This is not
authenticity detection or pixel-content redaction.

Requests use a fixed HTTPS endpoint, no redirects, no tools, no external URL
resolution, no automatic retry, a 45-second abort signal and 2,000 output tokens.
Image processing additionally has a five-second processing timeout per image.
Response bodies are bounded to 64 KiB. Provider refusals, incomplete output and
unknown source IDs fail closed. `store:false` disables response storage for the
request; it is not a claim that all provider retention is zero.

Price requires supplied `price-evidence` and exact decimal SEK. The adapter does
not search marketplaces, obtain completed-sale prices or certify an appraisal.
Model facts are always marked tentative. Staff sees the candidate, evidence,
questions and exact terms and must explicitly review before publishing through
the existing engine. Missing description/price or remaining questions prevent
that AI candidate from being shared. Staff can use the separate manual path to
correct the evidence. Seller approval is a later, separate operation.

## Attempts and recovery

The small append-only `reception_assistance_attempts` operational table records
the requesting actor, exact source revision, model and prompt version. Reservation
serializes with tenant membership and source changes. It permits ten attempts per
rolling 24 hours per store, spaced by at least 20 seconds. This is an initial pilot
guard, not a financial ledger or a guaranteed currency budget.

The same actor/request/payload can reserve only once. Retrying returns already
attempted and never invokes the provider again. Failure or a lost response consumes
the slot; a deliberate new request after the cooldown is another attempt. This
avoids duplicate calls but does not promise that every reserved attempt completes.
Staff can inspect attempts via authenticated reads; readonly cannot spend or read
this operational history. There is no administrative quota-reset UI.

Generated candidates are transient: refresh loses an unpublished candidate.
Staff publication saves the reviewed facts in the immutable review; it does not
retain a separate raw model response. Attempt records are not token usage receipts
or a persisted chain of every model transformation. Detailed usage accounting and
durable proposal recovery remain future work. No sensitive request/response body
or key is logged by the adapter.

## Verification and rollback

Unit tests use controlled HTTP responses and real Sharp decoding, including
metadata removal, malicious output, missing configuration, stale source and role
changes. pgTAP and a two-connection race test prove budget/replay boundaries.
`npm run test:assistance` starts an isolated local server with a test-only HTTP
interceptor, blocks external network calls and exercises staff publication in a
browser. Its output explicitly says HTTP FIXTURE. This interceptor is not imported
by the app and is never a hosted fallback. Stop any existing local app first.

Disable the provider setting/allowlist to stop new AI calls without disabling
manual reception. Keep immutable attempts and reviews; do not reverse the schema
or delete prior evidence. Real provider access, latency, accuracy, cost and quality
on actual jackets are unverified until a configured pilot is run.

Implementation references checked 2026-09-12:
[image inputs](https://developers.openai.com/api/docs/guides/images-vision),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[Sharp output metadata defaults](https://sharp.pixelplumbing.com/api-output/) and
[Sharp input bounds](https://sharp.pixelplumbing.com/api-constructor/).


## Explicit fact review

The staff UI requires confirmation for each included descriptive field and the
price/evidence, followed by the existing final publication confirmation. A model's
observed label never counts as staff confirmation; unchecked fields stay tentative.
Changing a selection clears the final confirmation. Missing description/price or
remaining questions still block publication. A lost publication response locks
selections and retries the exact existing request; no second provider call occurs.
See [review contract](RECEPTION-FACT-REVIEW.md).

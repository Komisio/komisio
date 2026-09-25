# Decision Log

- 2026-09-24: All eight languages use packaging-neutral terms for goods a seller hands over on one occasion (Swedish "inlämning", English "drop-off"). Bag remains a physical packaging type or example. Receipt identifiers, storage and acceptance rules stay unchanged.

- 2026-09-24: Store flow explains existing work with linked steps and internal per-step instructions. Owner/admin edits use revision checks; members can read. Instructions never change policy or execute work. Live queue metrics and free graph editing are deferred.

- 2026-09-24: Store currencies are SEK, NOK, DKK, EUR and USD only, all with two minor digits. Onboarding offers an explicit choice; existing defaults and frozen money facts are preserved. No currency conversion.

- 2026-09-24: Store profiles accept ISO 3166-1 countries independently of trading currency. Deployment signup blocks still apply only to registration/onboarding; profile edits never lock existing customers out.

- 2026-09-24: The 100-credit pack costs USD 10 for US profiles; SEK 100, NOK 100, DKK 65 and EUR 9 remain unchanged. Other countries use EUR; missing legacy country remains SEK. USD 10 is a fixed rounded price, chosen under owner delegation.

- 2026-09-24: Shopify connection and reconnection refuse a shop currency different from the store currency and retain a refusal event. The existing connection is preserved. Imported sales still require the store currency.

- 2026-09-22: Shopify shares one connection for web, POS or both, with owner/admin-selected location and publications. Settings lock after sync starts; account changes cannot move them. Import records channel/location and holds out-of-scope orders. Updating products never replenishes existing inventory.

- 2026-09-22: Owners approved own PayPal POS, Shopify and Fortnox accounts per tenant. Owner/admin connects; verified account identities stay pinned. PayPal credentials are encrypted per tenant; OAuth state binds tenant and selected account. Automation still requires its accepted scoped grant.

One line per decision: `- YYYY-MM-DD: <decision>: <why>`, at most 300
characters. The reasoning, the alternatives considered, the evidence and what
was verified belong in the pull request body, where git keeps them next to the
diff they explain. Read this file before re-litigating a past decision.

Do not write a new document under `docs/` to hold the reasoning for a change.
That habit produced 97 documents in a week, nineteen of which were working
notes with no reader, and it is what this rule exists to stop. A file belongs
in `docs/` when someone outside this work needs it later: a contract, an
integration, how to run the thing yourself.

Entries before the marker at the end of this file were written before the rule
(2026-09-17) and are left as they stand. A record is not rewritten to match a
later convention.

## 2026-09-15: Automatic label rule storage prerequisite

Per PR199, each store may configure one rule per label kind with a tenant-bound
printer and 1–20 copies. Owner/admin sets it through the engine; ordinary members
read it. Device and automation roles receive no new access. Identical repeated
settings are a no-op, changes are audited, and direct writes remain denied.
This storage/read prerequisite alone neither exposes an enable switch nor queues
labels. Event wiring follows the shared renderer and Fable's event-identity and
SQL-producer clarifications; label sizes remain per kind.

## 2026-09-15: Scoped automatic Fortnox sending

The accepted `fortnox_send` automation identity may begin/complete sends and
record connection checks, besides the existing revision-bound read/refresh.
Connect, disconnect, connection status and owner reconciliation remain closed.
The daily 07:00 UTC worker sends recorded exports only: no send history, or
exclusively proven preflight failures. Pending, sent and ambiguous histories
are never retried. One failure stops the store's run; other stores are isolated.
Each invocation examines at most 100 eligible exports and stops starting work
after 200 seconds; remaining exports wait for a later invocation. Existing fresh
begin dispatch permission prevents concurrent workers from posting twice.
Run summaries are append-only access events (replay-safe by run id), not a new
financial table. They record sent counts and complete/partial/failed outcomes;
complete means the eligible batch was processed, not that held exports are clear.
The owner controls the existing grant; no pilot grant is enabled by deployment.

## 2026-09-15: Fortnox client uses revision-bound renewal

The application renews only through `refresh_fortnox_tokens`; OAuth connection
completion alone retains the general store command. On a committed stale-revision
result the newly obtained tokens are discarded and the connection is reread once.
A second conflict fails closed. Missing revision fails before external renewal;
save errors never return rotated tokens or retry a write. Refusal logging uses
only `save_failed` or verified `invalid_grant` and the read revision; when the
database is unavailable logging is best effort, not a durability guarantee.
Owner/admin application checks remain in place until the scoped automation sender
and its audit permissions are wired. No automatic sending is activated here.

## 2026-09-15: Revision-bound Fortnox refresh prerequisite

Per Fable's revision answer, every connection insert/update receives a fresh
private sequence revision. Refresh requires the previously read revision under
the tenant lock and may only update ciphertext, scope and expiry, never company
or connection provenance. Owner/admin and accepted `fortnox_send` automation
may refresh and read that connection; connect, disconnect and status permissions
do not expand. A stale revision returns a typed `FORTNOX_CONNECTION_CHANGED`
result, not a SQL exception, so its refusal event commits with both revisions.
No-row refresh raises `FORTNOX_NOT_CONNECTED`. This database prerequisite does
not activate automatic sending or change the application's token refresh path.

## 2026-09-15: Owner confirmation of an existing Fortnox voucher

Fable approved the confirmed-sent-only reconciliation slice. An owner may record
bounded evidence and the externally verified voucher coordinates for a pending
or unknown send. The original send actor and company/export binding stay fixed;
new reconciliation metadata and an append-only access event identify the owner
and preserve the prior outcome. Exact actor-bound replay is a no-op, conflicting
evidence is refused. This cannot authorize another POST or record absence.
The first slice supplies the engine command only; a browser evidence/form slice
follows. No automatic send, token permission or provider call is introduced.

## 2026-09-14: Document operator-mediated MFA recovery

Implement owner decision B2 as docs/OPERATIONS-MFA-RECOVERY.md, not a new reset
permission: the store owner verifies the person, an authorized operator performs
the approved factor removal in the correct Supabase project and records restricted
support evidence, and the person re-enrols and verifies a fresh MFA login. Uncertain
identity, authority or a broader dashboard action stops the procedure. No service
key, membership change, financial write or weakened MFA policy is introduced.
The synthetic staging recovery exercise remains a pilot gate, not claimed evidence.

## 2026-09-15: Hosts see usage counts per store, never store content

`host_activity_overview()` gives platform hosts, next to each store's
plan state, the number of members, sellers and items, sales completed in
the last thirty days and the time of the last access event. Counts and one
timestamp only: no names, items or amounts leave a tenant through the host
page. Migration `20260916240000`, pgTAP `0094`.

## 2026-09-14: Exact photo repeats are recorded by digest and shown

The upload route records the SHA-256 of every reception photo
(`reception_photo_digests`, immutable). A reception whose photo bytes exist
in another reception of the store shows where they were seen, with the
seller; nothing is refused or removed. Similarity by model stays a design
in `docs/DUPLICATE-CHECK.md`. Migration `20260916230000`, pgTAP `0093`.

## 2026-09-14: Duplicate sellers are shown, never merged or blocked

Registering a seller first reads `seller_matches`: sellers of the store
with the same e-mail, the same phone number (compared without formatting,
the `00`/`+46` prefix and the trunk zero) or the same name. Matches are
shown with links and reasons; registering is an explicit second step.
Nothing merges, nothing is refused: two people may share a contact, and a
merge would move money and custody between people. Photo duplicates follow
the two-step design in `docs/DUPLICATE-CHECK.md` (content digest first,
model similarity behind the assistance port later). Migration
`20260916220000`, pgTAP `0092`.

## 2026-09-14: Fortnox retries must not duplicate external vouchers

Before automatic sending, enforce the existing at-most-one-voucher rule on the
transport path: only the caller that creates a send row may POST it. A pending
replay is observation, never permission to POST again; age alone cannot establish
that Fortnox did not receive it. Failures before POST remain retryable. Once POST
is attempted, a missing/invalid response or failed local acknowledgement is an
unknown outcome and blocks another send for that export pending reconciliation.
Conservatively retain old failed sends unless their code proves a preflight refusal.
No automatic resend of an ambiguous voucher, provider-side cancellation, financial
correction or new permission is introduced. This supersedes unconditional retry
of failed/stale sends, not the immutable export or company's database pin.

## 2026-09-14: Scheduled Zettle pull through the automation identity

The owner explicitly selected Fable's AUTOMATION-ACTOR model instead of the
earlier pg_cron bridge: Vercel Cron authenticates a knock every ten minutes;
the server signs in as the dedicated identity and signs out locally in finally.
Only an accepted, active zettle_pull grant may fetch for the pinned pilot store.
Existing grants must run again, not only newly accepted grants. No user session,
service-role client, signed owner JWT or provider key in SQL is introduced.

Keep public record_sale and record_zettle_page unavailable to automation. Extract
their unchanged engine implementations into private shared functions so validated
window imports can reach reconciliation without granting arbitrary sale writes.
The private sale path reads the same policy without widening its public reader.
All facts retain the automation identity; automation_grants retains the enabling
owner. Public window commands recheck the active scope under the tenant lock.

A narrow prepare RPC reserves one page per store and ten-minute slot in existing
access_events, returns only the pinned window/cursor/currency, and prevents duplicate
cron deliveries from repeating HTTP work. Successful pages remain in existing page
tables; bounded success/wait/failure events provide the last-run display. A crash
leaves a started event, never a false success; the next slot resumes the cursor.
One invocation fetches at most 100 receipts; catch-up is automatic but bounded.
No new staged kind, core table, dependency or financial rule is added.

## 2026-09-14: Staff may read Zettle image status

Extend the two narrow image reads to current staff as well as owner/admin, with
tenant and MFA checks unchanged. Image upload, association, source-reference tables
and all writes remain owner/admin only. A versioned status RPC prevents staff
pages calling the old owner-only implementation during deployment. Existing stock
RPCs are actually owner/admin-only; do not silently expand their scope in this slice.

## 2026-09-14: Retire the staged Zettle TypeScript surface

Choose removal rather than a manual staged fallback. Normal verified POS imports
still reconcile automatically; held receipts use the existing match/retry path.
Remove the Zettle proposal schema, queue presentation and review context from
TypeScript. Existing legacy rows are omitted from the UI queue and their review
URLs return not found; no historical rows are changed. SQL dispatchers, grants and
compatibility replay remain untouched. This supersedes the earlier TypeScript
compatibility-only retention, not the SQL compatibility contract.

## 2026-09-14: Compare Zettle mapping with the current engine VAT rate

Show the current store-policy VAT rate (default 25 percent) beside every Zettle
mode mapping, using the existing engine basis-point conversion. Mark missing,
invalid or different values without changing or blocking the tenant's mapping.
Equal percentages do not establish equal taxable bases, particularly for margin
modes. This is an advisory comparison for future sales, not a recalculation of
frozen sale facts or accountant approval. No financial rule changes.

## 2026-09-14: Owner escape for a blocked Zettle window

Only a current owner may abandon an unfinished latest pull window, with a trimmed
reason of 1–500 characters. An immutable closure records request, actor, time and
ZETTLE_WINDOW_ABANDONED; no receipt, sale or artificial empty page is created.
The next window starts exactly at the abandoned window's end, without replaying
its overlap. This can leave missing receipts and requires manual reconciliation.
Previously committed pages remain immutable and replayable; no new page may commit
to an abandoned window. Closure, page ingestion and window opening serialize on
the tenant lock. Scheduled transport remains separate from this owner escape.

## 2026-09-14: GitHub-managed staging migrations

The owner requires staging database changes to deploy through GitHub, without
manual CLI steps after each merge. A main-push job depends on successful platform
checks for the same revision. Only the main-restricted staging-database GitHub
environment supplies the staging project reference and Supabase management token;
PR jobs receive neither. Serialize migrations without cancelling an active push.
Check remote history, dry-run, apply missing committed versions and verify history.
Allow older missing versions only when all remote versions exist locally; never
repair history, reset, seed or update Vault as part of deployment. No application
service-role credential is introduced. Vercel still deploys independently, so
additive migrations and backward-compatible application rollout remain required.

## 2026-09-14: Explicit Zettle product image export

An owner/admin may export the first photo in the source revision of an accepted
reception review to the pinned Zettle merchant, using a separate image command.
Do not guess images for purchase/inspection origins or use a later source revision.
The command names no arbitrary path or URL. Server-side decoding produces a bounded
JPEG without metadata; originals and signed Storage URLs never leave Komisio.
Visible pixels become product imagery at Zettle, as stated beside the action.

Append-only integration intents pin tenant, item, product, merchant and source.
Only a fresh intent may upload; a lost upload acknowledgement holds for manual
reconciliation rather than uploading again. Persist the provider URL before
associating it using a conditional product PUT. Exact read-back reconciles retries.
Do not replace an unrelated remote image or erase unmanaged product fields.
Later product price exports preserve this registered image. Image export never
enables tracking, changes stock or records a sale. No image replacement/removal,
automatic selection from later photos or background scheduling in this slice.

[2026-09-11] Implement the authorized agreement-evidence slice with immutable tenant-scoped agreement versions and staff-recorded external evidence. Owners/admins publish plain text in an explicitly selected language; each version includes whether evidence is required before receiving. The newest sequential version is current. No published version means no new receipt prerequisite. No legal text, seller signature, BankID identity or financial entitlement is generated by this feature.
[2026-09-11] Publication checks the current version the admin reviewed; evidence records check the version shown to staff. Both operations serialize on the tenant with receiving/membership changes and have actor-bound stable request IDs. Existing receipts retain exact agreement/evidence references; replay checks precede current-policy checks so a previously successful receipt remains retryable after a policy change. Old clients cannot create new receipts against unseen agreement versions.
[2026-09-11] Evidence initially means a staff-attested reference to an external approval (for example a paper document or email retained by the store), not electronic signing. Require a non-empty reference, preserve who recorded it and when, and do not automatically translate agreement text. Published text, receipt prerequisites and evidence are append-only; evidence correction/revocation and seller-authenticated approval remain explicit follow-up work before external pilot use.

[2026-09-11] The owner authorizes activating completed, tested features directly in staging while no external end users are testing. Apply reviewed additive migrations to the verified staging project, enable the relevant feature, redeploy and verify the hosted flow without a separate activation approval. This does not authorize real payments or alter production release requirements.

[2026-09-11] The owner authorized autonomous workflow analysis and implementation, including reasonable assumptions, commits, PRs and green-CI merges. First domain delivery now receives a bag for later inspection, not priced items at the counter. Add only tenant-scoped sellers and immutable bag receipts; no VAT, commission, sale, agreement-acceptance or payout model is introduced.
[2026-09-11] Staff, admins and owners may register sellers and receive bags; readonly members may view these operational records. Seller contacts are separate from staff/auth identities and grant no login or membership. Require a name and either email or phone initially; never automatically merge matching contacts. A receipt records custody only and does not attest agreement acceptance or authorize sale.
[2026-09-11] Each bag is received separately with a stable client operation UUID, a globally unique printable reference, authenticated actor and timestamp. Retrying the same actor/payload returns the existing receipt; reusing a request ID with different content fails. Printing never creates data. No edit/delete API is exposed for custody evidence; correction operations follow in a later slice.
[2026-09-11] Tenant-configurable pricing approval, rejected-goods handling, agreement/receipt policies, self-drop-off, pickup and space booking are confirmed product scope. Bookings must support both seller-operated sales and shared store checkout. Implement these in successive slices; do not expose settings that falsely imply unavailable functionality. Stripe is a payout integration candidate; external POS owns checkout. Fee collection and provider suitability remain unimplemented.
[2026-09-11] Gate the initial receiving surface behind server-side KOMISIO_INTAKE_ENABLED=true until its additive migration has been applied in the target environment. The flag grants no data access: session/MFA checks, membership, SQL authorization and RLS remain mandatory.

[2026-09-11] Use Vercel-managed output when VERCEL=1 and retain standalone output for self-hosting: the first hosted build reproduced Next.js 16.3 issue #96646 (missing next-server.js.nft.json during Vercel packaging). No application or database behavior changes. Reference: https://github.com/vercel/next.js/issues/96646.

One line per decision: `[YYYY-MM-DD] <decision>: <why>`. Appended by agents
and humans when a non-obvious choice is made. Read before re-litigating a past
decision. Open product questions live in `docs/open-questions.md` and move here
when answered.

[2026-09-10] Komisio is rewritten from scratch, not migrated from the ABP/.NET codebase: the old system is a source of experience about store workflows, not a specification; its entities must not drive the new model (see experiments/2026-09-schema-sketch/README.md for what went wrong when they did).
[2026-09-10] The architecture rests on five fixed choices (one engine for all writes, rules enforced in the database, staged operations for agents, an extension contract, an MCP tool contract): they make the system testable and safe to operate by agents, and they are decided before any product model exists.
[2026-09-10] Phase 0 delivers the project foundation (repository, license, contribution rules, CI, agent instructions, open questions, tenancy foundation) and not the product data model: commission, VAT, settlement and payout semantics are product decisions that must come from real store flows first.
[2026-09-10] The first schema attempt is kept under experiments/ as a question generator, not migrated: it encoded product decisions (commission incl/excl VAT, margin-scheme eligibility, return handling, reservation at approval, credit-note settlements) before they were validated.
[2026-09-10] License is AGPL-3.0-or-later with an extension-API exception, and DCO instead of CLA (LICENSE, NOTICE, DCO): protects the hosted model, keeps contributor friction low, copyright stays with authors.
[2026-09-10] All code, comments, commits and documentation in English; UI in Swedish and English via message files; Swedish legal terms kept where precision requires: contributors and agents read English, store users read Swedish or English.
[2026-09-10] Stack is Next.js + Supabase (Postgres/RLS) + TypeScript strict: one stack for UI, engine, MCP server and extensions, with the database as the security boundary; trade-off accepted is leaving .NET expertise for an ecosystem where RLS, pgTAP and MCP tooling are first-class.
[2026-09-10] Tenant access is derived from membership only (tenant_members + user_tenant_ids() SECURITY DEFINER, policies `tenant_id in (select user_tenant_ids())`): a tenant id in a JWT claim grants nothing by itself.
[2026-09-10] Membership administration is owner-only, not open to every member: consignors' money and identities live in the tenant, so widening admin rights is a later explicit decision.
[2026-09-10] A tenant always keeps at least one owner (trigger): prevents a tenant from becoming unadministrable.
[2026-09-10] Business rules are written here before implementation and proven by a pgTAP test against real PostgreSQL; "the trigger is right" is replaced by "the rule is documented and the test shows it holds": a trigger is code and can be wrong.
[2026-09-10] Extensions may cause core writes only by staging an operation through the engine, rather than being strictly read-only: consignment needs POS/web sales to become core facts, and staging keeps audit and approval.
[2026-09-10] Komisio has no general ledger and never will: bookkeeping data is exported to an accounting system (Accounted or Fortnox) by an extension; the certified cash register belongs to the POS provider.
[2026-09-10] Domain rules (consignment, VAT, cash-register law) are written as skills under skills/ first and codified only when a decision requires it: rules stay readable by people and agents until a store flow forces them into code.
[2026-09-10] The first vertical slice is "register a consignor and receive an item", built through one engine from a minimal UI, an MCP tool and a test (docs/first-slice.md): it exercises the architecture's core question with the smallest possible model and defers commission, VAT and settlement until "sell an item".
[2026-09-10] The tenant is the single store; a chain is an optional grouping above tenants, and a user may be a member of one or many tenants within the same chain: the foundation's many-to-many tenant_members already supports multi-tenant users, so the chain level is added when the first chain customer needs it, without changing isolation. Answers open question #1.
[2026-09-10] The owner reprioritized delivery to the usable platform before consignment: build the web application, registration/login, tenant onboarding/switching, users/roles and the GUI as specified in ROADMAP.md. This supersedes the earlier sequencing of intake immediately after the database foundation; intake is the first domain slice after the platform completion gate. The roadmap's additional admin role is a proposal, not an applied change to membership policy.
[2026-09-10] The owner authorized taking over implementation of the platform roadmap. Adopt owner/admin/staff/readonly per tenant: owners administer ownership and admins; admins manage staff/readonly only. A tenant remains a store. Authentication identities belong to Supabase Auth; platform writes use authenticated RPCs with current membership checks, not service-role application writes.
[2026-09-10] Add Next.js 16, React 19, Supabase SSR/client, Zod, Tailwind 4, Radix Slot, class-variance-authority, clsx, tailwind-merge and Lucide for the web platform and accessible shared UI. Add TypeScript, ESLint, Vitest, Playwright and pg for static checks, browser tests and concurrent database tests. Exact resolved versions are locked by npm; application code is original and reference-project source is not copied.
[2026-09-10] Tenant creation is an atomic authenticated operation with a client request id; identity links reference auth.users; membership mutations serialize per tenant; invitations bind a hashed single-use token to a verified email. Active tenant is a server-validated preference, and mutations include the tenant the user saw so stale tabs cannot silently write to another tenant.
[2026-09-10] Context reads retry at most twice for the exact PostgREST PGRST303 "JWT issued at future" error observed with local PostgREST v16.2. All attempts use normal authentication and RLS; other authentication errors and mutations are never replayed. This is a bounded resilience measure, not a claim that the upstream cause is fixed.
[2026-09-10] Add Prettier as a development dependency for readable, consistently formatted original application code; it does not change runtime behavior.
[2026-09-10] Supersede the temporary context-read retry with a pinned local PostgREST v14.18, whose official release fixes sporadic PGRST303 JWT timing failures. The CLI default v16.2 reproduced the error even after retries. The prepare-local script writes the CLI 2.117.0 service-version override; CI uses the same pin. No token validation or RLS rule is relaxed, and the retry code has been removed. Source: https://github.com/PostgREST/postgrest/releases/tag/v14.18.

[2026-09-10] The owner created the Komisio GitHub organization and explicitly authorized publishing the new application as a public Komisio/komisio repository. Old repositories are used only to understand store workflows. Architecture references remain documented privately. This supersedes the earlier publication hold; it does not change the license or decide the future operating company.

[2026-09-11] The owner approved proceeding with the managed hosting plan: prepare a Vercel Pro / Supabase Pro staging deployment in Stockholm and Resend email. Preserve the existing tenancy model and use separate test/production infrastructure. The accepted product direction is a free core and SEK 199/month for operated integrations and automation; no billing or financial schema is introduced in this delivery.
[2026-09-11] Pilot invitation email uses the Resend HTTP API after successful authenticated invitation creation, with exact operator-approved recipients, an invitation-ID idempotency key and bounded timeout. Provider acceptance is not inbox delivery; ambiguous failures retain manual sharing. Public unrestricted email requires durable abuse controls and bounce handling first. No additional runtime dependency or service-role application credential is introduced.
[2026-09-11] UI language uses an explicit supported browser selection before the saved profile language, then Swedish: signup/login language must survive confirmation and store creation, whose initial profile defaults must not override that selection. Account settings continue saving both browser and profile preference. This affects presentation only, not authorization.

[2026-09-11] Under the owner's AI-first direction, inspection begins with a pure, versioned descriptive proposal contract shared by future GUI and agent adapters. A proposal may suggest description, category and observed condition, but never price, VAT, commission, acceptance or sale availability. Explicit field selection and matching tenant/bag/draft/revision are required to apply suggestions to an in-memory draft. This is not authorization or durable approval; no agent endpoint, persistence or model provider is introduced. See docs/AI-FIRST-INSPECTION.md.

[2026-09-11] Under the owner's approved saved-inspection delivery, persist descriptive drafts as append-only revisions attached to one received bag. Save requires owner/admin/staff, matching current tenant and bag, and the exact expected persisted revision (0 for new drafts). A stable actor-bound request UUID resolves successful retries even after newer revisions. A draft cannot move between bags or tenants. Shared staff may resume drafts; readonly may read. One explicit save is one draft revision, not commercial acceptance, inspection completion or sale availability. No price, VAT, commission, catalogue or AI-provider schema is introduced. Unsaved browser edits are not durable and the UI must say so; saved revisions are retained until an explicit retention/correction design is adopted.

[2026-09-11] Inspection history is a read-only surface over existing revisions, filtered by the authenticated current tenant, bag and draft. Historical links never open an editor or restore old data in place. The draft list uses bounded UUID cursors in stable draft-ID order so edits do not move rows between pages; new arrivals can appear between visits. No new persistence or authorization rule is introduced.

[2026-09-11] Under continued autonomous-development authorization, staff may archive or reopen descriptive inspection drafts with a required reason. Each change appends an immutable revision preserving the description and actor; no goods are returned, disposed of, accepted or offered for sale. Archived drafts cannot receive descriptive edits until explicitly reopened. Existing request IDs replay their original results, while stale saves/status changes fail. Active drafts are the default list; archived/all filters and direct history links preserve access. No new tables or financial rules are introduced.

[2026-09-11] Bag lookup is a read-only shared engine query, scoped to the active store and optionally the selected seller. Staff can search an exact printed bag number and browse 20 receipts at a time by immutable descending reference, using bounded keyset cursors. This replaces the inaccessible 50-receipt tail without inventing an inspection-completion state or adding persistence. Readonly users retain the same read access. New receipts may appear while browsing; paging is not a snapshot.

[2026-09-11] The owner authorizes autonomous single-garment vision/observation, metadata and price proposals, then mobile seller review. Shared headless contracts precede further GUI work. Price is a sourced proposed selling price, never payout or guaranteed sale. Seller agreement to a proposal is separate from store commercial acceptance. Skills guide inference; engine/database enforce identity and revisions. See docs/RECEPTION-ARCHITECTURE.md and docs/AUTONOMOUS-INTAKE-2026-09-12.md for scope and delivery order.

[2026-09-11] Under the owner's explicit autonomous reception authorization, persist reception_sessions and append-only reception_source_revisions. Sessions bind a store and seller without implying custody or commercial acceptance. Existing staff roles create sessions and append bounded source snapshots; readonly can read. Revisions and actor-bound request IDs prevent stale/duplicate writes. Source IDs retain their original content within a session; corrections use new IDs. Initial writes accept observation and price-evidence text only; photo references await the protected capture adapter. No seller access or financial record is introduced in this slice.

[2026-09-12] Under autonomous single-garment reception authorization, staff may persist a complete review snapshot against an exact source revision and the current immutable seller-agreement version. Metadata must cite supplied sources, price must cite price-evidence, uncertainty/questions must be resolved before publication, and suggested selling price is stored as numeric as well as the exact validated interchange payload. Reviews are append-only with actor-bound retry IDs and expected previous review. Expiry is explicitly supplied within seven days for the first pilot. A changed source revision invalidates a review for future decision. This slice publishes no external message and records no seller approval, sale or payout.

[2026-09-12] Under the owner's autonomous reception authorization, seller review access is separate from staff membership. An authenticated, confirmed-email account with required MFA must possess a random 256-bit review link and match the immutable review recipient email. Only a hash is persisted. Staff can replace or revoke access through immutable, optimistic events; a lost issuance response requires reloading current access and explicit replacement. No email is sent automatically. Seller reads expose only the reviewed metadata, price rationale, pinned terms and store name, not internal source notes. Approval/decline is an immutable response to the exact current review and source revision, with actor-bound retry and one response per review. It is not commercial acceptance, global agreement evidence or payout authorization. Stale, expired, revoked or wrong-account links are unavailable. A new review requires a new response. Phone-only identity and BankID remain future work.
[2026-09-12] Add one thin operator reception workspace using existing engine commands, not new financial tables. Manual fallback explicitly records a staff description and an appraisal (exact proposed SEK price, evidence reference and rationale) as versioned sources. These adapter-specific source payloads carry no extra authority; unchanged external sources are preserved and corrections get new IDs. Staff previews the saved snapshot and exact current terms before separately publishing a review, then explicitly issues/replaces/revokes the seller link. No AI output is fabricated and no mail is sent. Sessions can be resumed by exact ID or a bounded recent list. This surface does not infer physical custody or commercial acceptance.
[2026-09-12] Reception photos use a private, staff-scoped Storage bucket and immutable tenant/session/random-ID object paths. The initial adapter accepts bounded JPEG/PNG bytes with signature checks; images remain untrusted and are not guaranteed authentic or fully decodable. Source attachment independently verifies an existing matching object in SQL. Original objects cannot be overwritten or deleted through authenticated storage policies. Upload and source attachment are separate retryable steps; a failed attachment may leave a private orphan for later controlled retention cleanup. No seller storage access, public URLs, real model call or financial state is added. Photo consumers must revalidate bytes and authorization; external AI transmission remains separately configured.

[2026-09-12] Under autonomous reception authorization, add an optional OpenAI Responses adapter behind explicit server-only key/model/provider and exact tenant allowlist. Pin sharp 0.35.4 as a direct dependency (already used transitively by Next) for bounded decoding, orientation and metadata-free reduced JPEG derivatives; originals are unchanged. A small immutable reception_assistance_attempts table reserves one actor/request/source revision under the tenant lock: ten attempts per rolling 24 hours and at least 20 seconds apart. Failed/lost attempts consume capacity and identical requests never start another call. This is a staging cost guard, not subscription billing. Suggestions are transient, source-validated and tentative until explicitly reviewed by staff; existing review publication remains the only persistence/approval path. No automatic seller link, source overwrite, market-data fabrication, sale or payout. Unconfigured assistance stays unavailable; fixtures never masquerade as live inference.

[2026-09-12] Add a local stdio MCP adapter for reception reads and non-persisted proposal previews, using the same engine and authenticated Supabase user session. The local host explicitly configures one store and a subset of read/preview scopes; these restrict this process, not the underlying user's JWT. The model cannot select another store, write sources, invoke paid inference or publish/approve. Preview results explicitly report persisted:false and staged:false; no durable pending-operation claim. Hosted OAuth with audience-bound authorization and durable agent staging remain separate work. Pin @modelcontextprotocol/server and client 2.0.0 plus tsx 4.23.13 for the official protocol transport and TypeScript entry point. No custom JSON-RPC imitation.

[2026-09-12] Seller reviews may include immutable, reduced JPEG derivatives of reception photos. New staff uploads decode and prepare a metadata-stripped derivative before attaching evidence. At publication the database pins the available derivative IDs from that exact source revision; existing reviews keep an empty photo list and never acquire images later. Original photos remain staff-only. A seller image read requires the same confirmed identity, MFA and current review capability as the review itself, enforced again by Storage RLS with the authenticated download operation and a bounded capability header. Seller listing, signed URL creation and writes are denied; no service-role bypass. Revocation applies to subsequent requests, not already downloaded pixels. Staff must inspect the visible image content before publication; stripping metadata does not redact people or labels. This adds no custody, commercial acceptance or financial state.

[2026-09-12] Local MCP may expose one reduced reception image per call under the separate opt-in reception:photos scope. Ordinary reception:read does not include image bytes. The tool requires the exact current source revision and attached photo ID, rechecks identity/membership/MFA and revision after download, and returns a minimized JPEG as native MCP image content with source provenance. The external host may transmit that image to its model; no Komisio provider call or durable write occurs. Visible pixels remain untrusted and are not redacted. No remote URL, Storage path or token becomes a tool argument.

[2026-09-12] Hosted Storage performs an authenticated object-info check before downloading a private image. Seller photo access must accept both authenticated download and authenticated info operations, using Supabase's operation helper to normalize its optional storage prefix. Both operations still require the exact pinned derivative, confirmed recipient, current capability, MFA and expiry. Listing, signing, unknown operations and writes remain denied. This fixes hosted compatibility for already-authorized review images; it does not grant broader seller or staff access. Regression checks must exercise actual HTTP info requests as well as downloads.

[2026-09-12] The reception queue is a tenant-scoped read model, not a new lifecycle table. Derive work stage from the latest source/review and exact response: preparing, needs_review, approved, declined, expired, ready_to_share, link_revoked or awaiting_seller. Source changes take precedence over historical approval; expiry/revocation never erase a saved response. Link availability is separate. Filter in SQL before a21-row bounded result (20 plus lookahead), ordered by immutable creation time and ID. A security-invoker read preserves existing RLS, verified identity and MFA; no financial or commercial authority is added.

[2026-09-12] Local MCP reception:read also exposes the bounded shared reception queue for the configured store. It returns seller display names, current work stage and version references, not contact details, capabilities or images. Tenant cannot be supplied by the model. The same verified identity/MFA and database RLS apply; no write scope, provider call or commercial authority is added.

[2026-09-12] Staged operations exist as immutable proposals plus one immutable decision each: a non-human actor (an MCP host under a staff member's session, labelled) proposes a complete engine command; a staff member approves or rejects; approval executes the ordinary engine function as the approver, so the recorded actor of the resulting fact is the person, and a failed execution is recorded as a failed decision rather than retried. Risk level derives from the kind, never from the proposer; the first kind, publishReceptionReview, is low risk and may be approved from the same session that proposed it, while medium and high kinds require a different person. Proposals expire within seven days and are preflighted against the same preconditions the engine enforces, so stale proposals fail at proposal time. No auto-execution scope exists yet. This is the first write path for agents and stays gated by the intake flag.
[2026-09-12] Seller reads (review page, photo descriptor, Storage policy) are STABLE functions that take no tenant row lock; only the seller response keeps the locking variant, which serializes with staff replacement and revocation and rechecks every condition under the lock: a seller opening a review with photos was taking the store-wide write lock several times per page, which is harmless at pilot scale and not with a chain or camera station, and STABLE makes FOR UPDATE impossible by PostgreSQL rule rather than by convention.

[2026-09-12] The MCP staged-review adapter uses the proposed review's fixed expiry as the operation expiry. Recalculating an expiry from the request clock changed the immutable envelope on retry and caused REQUEST_CONFLICT in the real MCP test. Fixed input plus request ID must preserve that envelope and must not extend its approval window. Existing SQL validation bounds both expiries; no migration is needed.

## 2026-09-12: staged descriptive edits to existing inspection drafts

Owner-authorized AI-first continuation extends the existing pending-operation
mechanism with saveInspectionDraft. It is low-risk descriptive editing only:
exact active base revision, complete bounded description/category/condition,
no-op rejection, immutable proposal and explicit staff approval through the
existing engine save. No new table or commercial/financial rule. SQL rechecks
stale/archive/role/MFA and commits decision plus save atomically; retry semantics
remain exact-envelope. Staff field confirmations are a UI review aid, not a new
authorization boundary. See docs/STAGED-INSPECTION.md and the associated SQL tests.

## 2026-09-12 — Lead architect, roadmap baseline and v1 exclusion

The owner appointed Claude Fable 5.1 as lead architect and selected
`docs/FUNCTIONAL-ROADMAP.md` as the evolving baseline for continued development.
Agents read the latest roadmap before selecting work; Astra implements, verifies
and integrates against it. Architectural disagreements are recorded for the lead
architect and owner instead of silently superseding the baseline.
All 100-hours functionality is outside version 1, including its hourly markdowns,
dedicated lifecycle stage and associated screens/feed. Do not build v1 dependencies
on it. This scope decision does not change access controls or resolve outstanding
financial rules. No database migration is needed for this documentation decision.

## 2026-09-12 — Unsaved inspection-to-reception preparation

Following FUNCTIONAL-ROADMAP.md, compare only descriptive fields from an existing
saved inspection draft with the existing reception contract. Keep the actual
bag/draft/revision provenance separate from reception source IDs. Candidate text
is untrusted, unsourced and requires review; do not manufacture observed facts,
price, terms, a session or consent. A4 semantic equivalence remains unconfirmed.
The preparation checklist does not search other receptions or agreements and
cannot establish that they are missing. Use shared pure comparison in staff UI
and an authenticated exact-revision read in MCP; no migration or persistence.

## 2026-09-12 — Per-fact staff review of reception suggestions

Implement roadmap P1's explicit review in the built-in AI publication UI and
staged reception decisions. Each included descriptive field and the price require
confirmation; model-supplied observed certainty does not count. A shared pure
helper validates selections and leaves unchecked candidate fields tentative.
The final publication confirmation remains separate and clears when selections
change. No new authorization, financial rule, audit table or migration is added;
existing SQL publication/decision guards remain authoritative. Rejecting a staged
proposal requires no field confirmation; exact-request retry stays locked.

## 2026-09-12 — Exact retry of an uncertain staff operation decision

Freeze the complete first decision request in the staff UI and lock its inputs.
After an unknown response, expose only an explicit same-decision retry; do not
let edits to reason or approval/rejection reuse that request ID. Existing SQL
idempotency and authorization stay unchanged. Test both a committed approval with
a lost response and a rejection interrupted before reaching the server. No new
business rule or migration is required.

## 2026-09-12 — Paged and filtered staff operation queue

Add a bounded authenticated read so older open proposals are not hidden by the
legacy newest-50 window. Preserve operation_queue(uuid) compatibility; the new
read uses existing derived status and an exclusive creation-time/UUID cursor.
The engine returns 20 rows plus next-page guidance, retaining timestamp precision.
No status, authorization or write semantics change. SQL tests precede the additive
read-function migration; no new core table or financial rule is introduced.

## 2026-09-12 - Provider-independent evidence boundary

Narrow the existing reception assistance port to garment source evidence only.
The shared orchestrator, not each individual provider, omits tenant/session/seller
identities, source revision and photo Storage references before calling adapters.
Source IDs remain for citation validation; supplied text and visible pixels remain
untrusted and may contain personal data. This is field minimization, not redaction
or a sandbox for arbitrary in-process code. Validate returned candidates against
an isolated trusted snapshot, then mark every returned descriptive fact tentative
regardless of provider certainty. Staff confirmation and engine publication rules
stay unchanged. No new provider, prompt wording, reservation rule or migration.

## 2026-09-12 - Scoped MCP operation discovery

Expose paged operation summaries through existing reception:read and inspection:read
MCP scopes. The host pins operation kind and tenant; models supply only the existing
status/cursor input. Apply kind filtering before the database page limit. Preserve
the four-argument paged RPC as a delegating compatibility wrapper and the legacy
newest-50 RPC unchanged. Return only IDs, kind, risk, derived status and timestamps;
no payload, people, actor label, decision reason or write. Existing scoped exact
operation reads supply details on demand. No new scope, table or authorization.

## 2026-09-12 - Compare a staged review with its exact prior publication

Read the prior immutable review identified by previousReviewId within the same
tenant and reception. Show changed descriptive values/citation sets, price with
rationale/citations, and source/agreement version changes. A first publication has
no baseline. This is read-only guidance, not seller consent, acceptance, proof of
unchanged evidence or a complete legal diff. All field confirmations and existing
SQL current-version checks still apply; no prior decision is inherited. No new
persistence, authorization, financial rule or migration.

[2026-09-12] Four label templates ship on day one (bag, item, onboarding slip, markdown), rendered by one label engine and printed through the local print agent: the owner confirmed all four are needed from the start; other purposes (shelf, storage, pickup, transfer, shipping) are added when a store asks.
[2026-09-12] Store-owned (purchased) items are in scope for the first sale slice alongside consignment items: the owner confirmed it; ownership is a per-item fact frozen at acceptance and the VAT treatment per sale line depends on it (open question 5 still decides the treatment itself).
[2026-09-12] Zettle is the first POS integration, pulling sales in the sell-and-settle phase and pushing accepted items afterwards; Shopify POS follows on the same adapter contract: Zettle was the earlier system's live sales path and owns the certified cash register.
[2026-09-12] Seller notifications go by e-mail first; push to the seller app comes later as a second channel on the same notification policy: the owner prefers e-mail as the primary channel; text is generated by the model inside a fixed, store-editable template and every sent notification is logged in the seller's communication log.
[2026-09-12] Commission basis (inclusive or exclusive of VAT towards the seller) is a tenant policy whose default comes from the consignment skill, with a per-seller flag that overrides it: private sellers are normally quoted inclusive, business sellers may be invoiced commission plus VAT, and one store can have both. Answers open question 2.
[2026-09-12] Commission rate, sale period, markdown steps and end-of-period action are frozen per item at commercial acceptance and never rewritten by a later policy change: the seller agreed to those terms for that item; a store that wants new terms needs new evidence. Answers open question 3.
[2026-09-12] Staff attest physical custody of a wall garment with a receipt-like custody event by default; the custody source is a tenant policy so a locker or seller drop-off can be allowed later: acceptance always requires a custody fact from one of the allowed sources. Confirms convergence assumption A1.
[2026-09-12] A published seller agreement is required for review publication and for commercial acceptance by default and optional at bag receipt; the prerequisite is one tenant policy evaluated identically by every intake command: today's asymmetry between the two paths becomes a deliberate default instead of an accident. Confirms convergence assumption A2.
[2026-09-12] By default the store sets the selling price and the seller has delegated that decision to the store, its AI and its statistics through the general agreement; per-item seller approval of a review is an opt-in tenant policy, not a prerequisite for acceptance: the owner judges per-item approval overkill for most stores, and the built review and response flow remains available where a store wants it. Overturns convergence assumption A3.
[2026-09-12] Category and condition are two separate facts on every description, in inspection drafts and in reception reviews alike; they are never merged or derived from each other and acceptance takes both from the origin without mapping: the owner stated they are distinct things. Resolves convergence assumption A4.
[2026-09-12] Store-owned items enter through a separate purchase registration without a seller, or through the POS integration (Zettle first, then Shopify POS) when the POS already holds the item; never through the consignment intake paths: acceptance gets a third origin, purchase, with ownership store, no seller, no agreement and no seller consent.

[2026-09-12] P1 S1 starts with a strict, explicit policy-body validator matching P1-SLICES.md. It does not infer missing commercial defaults, execute markdowns, calculate VAT or authorize writes. Numeric JSON inputs must be finite, nonnegative and have at most two decimal places; percentage inputs cannot exceed 100, day offsets are nonnegative safe integers and sale duration is positive. Duplicate entries in the two policy subsets are rejected. Schedule execution semantics remain open question 4; no ordering, compounding or end-of-period interpretation is invented here. SQL will independently validate published policy bodies before this contract is connected to a write surface.

[2026-09-13] The owner confirmed the complete pilot store policy from Fable snapshot 17e73c8: store commission 60 percent inclusive, 42 sale days, markdown steps 10/25/50 percent at day 14/28/42, charity at period end, unsold notification at day 60, minimum payout SEK 100, staff custody, delegated pricing and agreement required for review publication/acceptance but not bag receipt. Add unsoldNotifyAfterDays to the S1 body. These are configurable product defaults, not tax law or authorization to execute markdowns, disposal, notifications or payouts. Assistance enablement remains S9. S0 per-kind dispatch precedes S4 but does not block S1. Per owner coordination, do not integrate Fables newer commits until PR58 is complete; the implementation uses the owner-confirmed values without cherry-picking those commits.

[2026-09-13] S1 policy publication is owner/admin-only, append-only and tenant-serialized. Replay binds identity, tenant, explicit policy and expected predecessor; later versions do not change a prior retry. Members including readonly can read the effective policy, with the same MFA boundary as other engine reads. An optional review agreement is represented by null, never invented terms; when an agreement exists its current exact version remains mandatory. Legacy required-before-receipt remains an additional requirement. No-policy reads use the confirmed pilot body.

[2026-09-12] Stores sell both on commission and in their own name (purchased goods), and the VAT treatment of every sale line is frozen on that line together with its basis (ownership, commission basis, margin-scheme eligibility and its evidence): the owner confirmed both models; the exact VAT cases are written in skills/consignment-sweden/SKILL.md and verified against Skatteverket before they become engine rules, and no VAT amount is computed by the engine until then. Answers open question 5 in scope, not in rule.
[2026-09-12] A customer return with full refund reverses the seller's credit in full, puts the item back on sale and keeps both sale lines in history; a return after a payout of that credit is flagged for staff review and never silently nets against the next payout: the owner confirmed it; partial refunds are a later decision. Answers open question 7.
[2026-09-12] Payout funds are reserved when staff approve a payout request, not at request and not at transfer; the seller's app shows available balance minus reserved: the owner confirmed it. Answers open question 8.
[2026-09-12] The settlement statement (avräkningsnota) is a numbered, immutable document the seller receives, corrected only by a numbered credit note: the owner confirmed it. Answers open question 10.
[2026-09-12] The first payout rail is manual: staff mark a payout as paid with a reference after paying outside the system; Swish and Stripe follow as adapters on the same payout state machine: the owner confirmed it. Answers open question 9.
[2026-09-12] The day close exported to accounting is per VAT treatment and per payment method, with seller balances reported as a liability to sellers, and Fortnox is the first target: the owner confirmed it; a per-channel split is added when a second sales channel exists. Answers open question 6.
[2026-09-12] Settlement statements and receipt evidence are retained for seven years and agreements at least as long as an item under them can be settled; kassaregisterlagen is fully delegated to the POS provider and the core never presents itself as a cash register: the owner confirmed both. Answers open questions 11 and 13.
[2026-09-13] Staged operations dispatch per kind: each kind has private validate, preflight and execute functions and a risk entry, and propose_operation and decide_operation are short dispatchers with one case line per kind: three migrations had re-declared the full dispatcher bodies to add one kind each, which would have repeated for every P1 and P2 kind; behaviour and error codes are unchanged and proven by the existing tests running unmodified.
[2026-09-13] VAT treatment is a tenant setting: the store selects its VAT modes (consignment from private sellers: margin or full; store-owned: margin with per-item attested eligibility, or full) in the store policy together with its accountant, and Komisio computes the selected mode deterministically per sale line, freezes mode, basis and amount on the line, refuses to record a sale until a mode is chosen, and never claims a mode is legally correct for a store: the owner judged that this responsibility belongs to each tenant, which removes an external verification gate from the sale slice while keeping the arithmetic tested in both application and database.

[2026-09-13] PR59 independently merged S0 and applied migration 20260913090000 while PR58 was in review. S1 reconciles against published main aa19a0b without importing Fables unmerged work. A later additive migration restores S0 dispatch and adds policy-aware nullable-agreement validation/preflight, so fresh installs and backfilled staging migrations converge. No applied migration or history record is edited.
[2026-09-13] A garment received outside a bag gets its own custody fact, garment_receipts, recorded once per reception session by staff with a printable reference (G-n) and an optional note; a session, photos or a seller approval never prove custody, and commercial acceptance of a garment origin will require this receipt: confirms convergence assumption A1 for the default custody source; locker and seller drop-off sources are added when the store policy (P1 S1) allows them.
[2026-09-13] Store-owned goods are registered as purchase_receipts with price in öre, a required evidence reference and margin-scheme eligibility attested by the registering staff member at the purchase: the owner decided purchases enter separately from consignment (2026-09-12), and eligibility must be attested when the goods are bought, so it is a fact on the purchase that acceptance copies and the VAT mode consumes, never re-derived later.

[2026-09-13] Seller terms are append-only versions per seller with a nullable commission basis and rate, where null means follow the store policy; effective_seller_terms merges the current policy with the seller's latest version at read time and is what commercial acceptance (S4) freezes onto the item: the owner asked for a per-seller flag and rate override without making sellers mutable. Staff may publish seller terms because they agree them at the counter, while the store policy stays owner or admin; the staged agent kind for proposing seller terms follows with S4's operations work.

[2026-09-13] Commercial acceptance is one command, accept_item, for three origins (inspection draft, reception review, purchase receipt): it checks the origin is current, custody exists for consignment origins, the agreement prerequisite from the store policy is evidenced for the current agreement version, and the seller review mode (delegated needs no seller answer; per_item needs the seller's approval of that exact review at that exact price), then freezes commission, sale period, markdown steps, end-of-period action, agreement version and evidence kind onto an immutable item with a first price row and events; later policy or seller terms change later items only: this is the convergence docs/INTAKE-CONVERGENCE.md decided and the owner's A1 to A4 answers, and one item per origin is a unique constraint under the tenant lock so two acceptances of one origin cannot both succeed. The staged kind acceptItem at risk medium and the MCP tool follow in a separate slice.

[2026-09-13] The reception queue derives its stage from the store policy: under delegated pricing a current review goes straight to awaiting_custody and then ready_to_accept without a seller answer, under per_item the seller link and response flow applies before custody, an accepted item shows as accepted, and changed evidence outranks everything as needs_review; the former approved stage is replaced by the two custody-aware stages because a seller approval never proved that the garment was in the store. The seller link stays available in delegated mode as an optional courtesy, so no existing flow breaks; hiding it per tenant is a later refinement.

[2026-09-13] Provenance travels with the item as one immutable provenance event written by accept_item: who saved the origin and when, the exact review or draft revision, the per-fact certainty the published review carried, the price evidence sources, every model attempt on the reviewed source revision, and the staged agent proposal with its approver when an agent produced the origin; it records references and facts, never the origin's text, because the origin stays the evidence and the item must not become a second copy of it. Purchases carry no origin provenance.

[2026-09-13] Agents may propose commercial acceptance as the staged kind acceptItem at risk medium: preflight checks the origin is current, not already accepted and in custody, approval by a different identity than the proposer runs accept_item with every check re-evaluated, and the item id is the operation id so replay and provenance line up; the MCP scope items:propose exposes komisio_propose_acceptance and nothing else, because the P1 exit requires an agent-proposed acceptance approved by a second person and the existing rule already forbids self-approval above low risk.
[2026-09-13] A sale is one immutable fact per provider and external id with its lines frozen at recording: price, ownership, commission basis and rate, commission in öre, seller credit, VAT mode, rate, basis and amount, agreement version, seller terms version and policy version, all computed by the database from the item's frozen terms and the policy in force; replay by id or by external id returns the same sale and a different payload under the same external id fails. Commission arithmetic: inclusive basis takes the rate of the sale price and the seller receives the rest; exclusive basis takes the rate as commission ex VAT, adds VAT on the commission invoice, and selects the business VAT mode as an interim proxy for a VAT-registered seller until seller VAT registration exists. Recording a sale never pays anyone; balances and payouts are later facts.

[2026-09-13] The seller ledger is append-only and written only by engine functions: a completed consignment sale line credits the seller's share at the sale time, corrections are owner-or-admin adjustments with a reason, payouts and returns will add their own kinds, and every balance is a sum over signed entries computed at read time rather than a stored column, so no number shown to a seller can drift from the facts behind it.

[2026-09-13] Payouts are facts with four states and a rail of manual: a request moves no money and is bounded by the available balance and the policy minimum, approval reserves the amount in the seller ledger, payment requires a payment reference and settles the reservation as released plus paid, rejection releases an approved reservation, every transition is its own immutable event and the payout row changes status only inside those engine transitions; Komisio records the payout and never transfers money itself.

[2026-09-13] A return is a new immutable fact that reverses one sale line in full: it writes a credit reversal to the seller ledger, frees the item for resale, leaves the sale row untouched and flags itself for review when the seller's available balance no longer covers the reversed credit because a payout was already reserved or paid; partial refunds are refused with a clear code until a later slice defines them, and the flag is a work item for a person, never an automatic clawback.

[2026-09-13] A settlement statement is a numbered, frozen document computed from the seller ledger for a half-open period: the number comes from a per-tenant counter in issue order, the opening balance is the sum before the period, the lines are the period's ledger entries with sale price and commission where they came from a sale, the header totals are written once inside the issuing transaction and never again, a period may not overlap an earlier uncorrected statement, and a correction is a credit note that references exactly one original; rendering and delivery are separate from the fact.
[2026-09-13] Built-in assistance is enabled per tenant by the store policy key assistanceEnabled (absent means off), while provider, model and key stay in server configuration as the kill switch and the environment allowlist remains only as a pilot fallback: the tenant decides whether its staff may ask for proposals, Komisio decides whether the service runs at all, and no policy value can select a provider or a model.

[2026-09-13] A day close is a versioned fact for one Europe/Stockholm calendar day computed from completed sale lines, returns, credit reversals and paid payouts, with VAT per mode so a tenant's mode change stays visible in the books; regenerating an unchanged day returns the existing version and a changed day gets the next version while earlier versions remain. The accounting export will take its account numbers only from a tenant policy set with the store's accountant; Komisio proposes no chart of accounts.

[2026-09-13] Seller communication is a log first: every message is queued as the exact subject and body rendered from a versioned plain-text template bound to a fact the seller owns, sent through the transport under the pilot allowlist rules, and closed with one recorded delivery outcome; a retry of the same request never sends twice because the stored outcome is returned instead, and no template accepts markup, links or model-written wording outside the free-text block.

[2026-09-13] The sale period is a derived work list, not a scheduler: stages come from the item's frozen period, extensions and markdown steps at read time; a markdown is applied by a person, once per step and only when due, as a share of the accepted price rather than of the previous price; an extension and an end of period are events with a reason or action; an ended item cannot be sold; nothing changes an item without a person's command, and agent proposals for markdown batches will go through staged operations.

[2026-09-13] S14 MCP seller-economy reads require explicit economy:read, host-pinned tenancy and the existing authenticated engine reads. Balance is computed by SQL, never by the model. The bounded ledger tool returns at most 50 recent events without free-text reasons, contact data or actor identities and marks the result as a partial, non-atomic view. All exposed ore values must be safe integers; unavailable precision fails closed. No ledger adjustment, payout, accounting rule or agent write is added.

[2026-09-13] CI exposed ambiguous item-price ordering: now() is constant within a transaction and UUID order is random. New item-price rows receive a strictly increasing per-item set_at timestamp under the tenant lock (clock time or one microsecond after the latest row). Historical rows are immutable and not reordered; any older ties need a separate data audit. This changes ordering, not markdown percentages or financial formulas.
[2026-09-13] Printing is a job queue, not a device driver in the core: a label is a ZPL program rendered from a versioned template with every dynamic value stripped of control characters, queued for a registered printer against a fact of the store, claimed by a local agent that is an ordinary store member with a dedicated account, and closed with one printed or failed outcome; stale claims are handed out again after ten minutes, a queued job can be cancelled, and printers are registered by owners or admins only.

[2026-09-13] Integration with Fable PR76 retains its identity sequence as the lifecycle ordering key. The additive timestamp trigger complements that sequence for chronological readers and display timestamps; neither migration is rewritten after local application.
[2026-09-13] Three more staged kinds reuse the dispatch recipe rather than new approval paths: a return is medium and needs a second person, a ledger adjustment is high and still executes only for an owner or admin approver (a staff approval records a failed outcome and moves nothing), and a markdown batch is low but refuses the whole batch unless every step is due now, then applies all or nothing. Agents get no new authority; they get more things to propose.

[2026-09-13] Usage is metered by triggers on the fact tables, not by callers: a stored assistance attempt, a queued seller e-mail and a queued print job each write one immutable unit for the store month in Europe/Stockholm. The only quota is the monthly assistance quota in the store policy, checked before the attempt is stored; other features are counted only. Komisio reports usage, it does not bill from this table.

[2026-09-13] A bulk operation is one proposal over many items, not many proposals: the set is refused whole if any item is sold or ended, applied all or nothing under one approval by a second person, and every item still gets its own event through the ordinary single-item command. Reprint is not staged because printing changes no fact.

[2026-09-13] Astra task 1 gives sellers an authenticated economy portal, not tenant membership. A verified session (including MFA) must match the seller's normalized email; ambiguous duplicate addresses within a store fail closed. Review tokens alone grant no financial access. Narrow definer projections retain staff-only table policies and omit staff identities and private ledger reasons. Both staff and seller balances use one SQL calculation. Seller payout requests reuse the same threshold, available-balance and replay checks with an immutable request source; approval and payment remain staff commands. Notification preference changes are append-only per seller, and automatic dispatch must log seller_opt_out before transport. These are the owner-authorized seller capabilities in PR86; no payment rail is activated.
[2026-09-13] Seller notifications are automatic only when the store opts in, and an automatic message is nothing new: the same logged, template-bound communication a person could send, with an id derived from the fact so one fact notifies once, sent after the fact is committed so a failed e-mail never hides a sale, a payout or a statement.

[2026-09-13] The accounting export is a faithful formatter, not an accountant: the tenant publishes a versioned map from each day-close amount to an account and a side as its accountant set them, Komisio turns one day close and one map version into voucher lines, reports unmapped amounts instead of folding them into a balancing line, refuses a voucher that does not balance, records each export once per day close and map version, and renders the SIE 4 file from the recorded lines so a download never recomputes the books.

[2026-09-13] The P2 accounting browser journey reproduced a server/client serialization failure when a day-close preview existed. Display formatting now lives in the interactive component and only serializable labels cross the boundary; voucher arithmetic and export authorization remain in the engine.
[2026-09-13] Local verification found that applying the previously missing usage migration after the notification migration replaced the policy validator with its older definition. An additive reconciliation restores the published notification-aware validator verbatim; no policy values or migration history are rewritten.

[2026-09-13] The P2 settings journey exposed printer-field hydration mismatches because a random command id was also used for DOM labels. React useId now supplies stable field/label identifiers; the printer command id and its replay semantics are unchanged.

- 2026-09-13: Batch reception (Astra task 3) uses at most three authorized photos and eight proposed garments for one seller/source revision. Provider rows contain sources and tentative suggestions only. Each explicitly staff-reviewed row prepares a separate reception through existing engine commands and stages the existing publishReceptionReview operation; it does not record custody, consent, acceptance or a sale. Stable derived request identifiers make partial retries replay-safe. Original and seller-derivative photos stay under each child session's existing storage boundary. No new tables, grants, operation kinds or live-provider activation. The additive migration only admits the versioned batch prompt to the existing quota reservation function.

- 2026-09-13: Zettle S12 imports immutable, minimized whole purchases. All rows must be matched before any sale is recorded under the purchase UUID; no partial subset is recorded then appended. First fixture slice holds refunds, discounts, fees, gift cards, non-unit quantities and inconsistent totals rather than inventing allocation/rounding. Existing short item labels must match exactly and uniquely within the tenant. No live OAuth, keys or transport are introduced. Financial registration remains subject to the existing staged-write architecture; the fixture transport itself never writes core facts.
- 2026-09-13: The Fable PR83–87 dispatcher stack is merged and the Fable worktree is clean. S12 adds recordZettlePurchase through that dispatcher, medium risk like returns: a different staff identity approves. Immutable import evidence and append-only line resolutions precede the proposal. A changed match revision invalidates the proposal. This is the whole-purchase interpretation of S12, preserving record_sale replay rather than extending a recorded receipt.

- 2026-09-13 owner correction: Zettle is the POS. Approved saleable Komisio items synchronize outward; completed Zettle sales synchronize inward, marking items sold and crediting sellers automatically. A second employee must not approve normal POS facts. This supersedes the earlier Astra medium-risk Zettle registration decision, not the approval rules for AI proposals or payouts. Unknown/ambiguous rows remain held, and matching all rows triggers recording of the complete receipt exactly once.
- 2026-09-13: Catalog exports use stable product/variant identifiers, exact engine prices and a tenant-configured POS VAT mapping chosen explicitly by owner/admin. No VAT mapping is inferred from margin treatment. Persistent export snapshots and outcomes support retry/reconciliation. HTTP contract tests use the current Zettle Product Library/Purchase specifications and an isolated local simulator; they are not evidence of live OAuth or merchant compatibility.

- 2026-09-13: Zettle product export snapshots bind the current engine policy revision as well as price and explicit POS VAT mapping. A policy change cannot silently replay an older export. Current API conditional PUT must match the last acknowledged managed payload and its ETag; external edits or missing previously exported products are held. Product Library is not inventory: stock initialization, delisting and live OAuth remain separate unverified work. No new dependency.

- 2026-09-13: Owner supplied a Zettle client ID and API key in Vercel. The pilot uses the official assertion grant, never client-secret authentication. The credential is available only to an explicitly configured ZETTLE_PILOT_TENANT_ID, without fallback for other tenants. Owner/admin with current MFA may run a read-only identity check; no catalog, purchase import or financial write is activated by that check. Tokens and assertions stay server-side and out of logs. A separate expected merchant ID can pin subsequent checks. Multi-tenant self-service OAuth/encrypted credential storage remains a separate slice; no new tenancy model or dependency is introduced.
- 2026-09-13: Settlement batch (P3, Fable): `settle_payouts` requests and approves one payout per listed seller in one transaction as the caller, all or nothing, and records the batch in append-only `payout_batches`; payout and event ids derive from the batch id and the seller id so replay and notifications find the same rows. Candidates are sellers at or above the policy threshold with no open payout; a seller with an open payout is excluded, never topped up. The staged kind `settlePayouts` (medium) proposes the same batch for a second person; preflight equals the command's checks. No payment rail: the store still pays through its bank and marks each payout paid.

- 2026-09-13: Zettle client IDs follow the OAuth string contract, not a locally invented UUID restriction. Trim surrounding pasted whitespace consistently before validation and transport. The explicit tenant match remains mandatory. Owner/admin diagnostics expose only fixed reason codes, never credential values or another tenant's credential readiness. Configuration changes require a new deployment.
- 2026-09-13: Economy overview (P3, Fable): `economy_summary(tenant, from, to)` is the one read model for the store's numbers over a period, computed from the same facts and with the same sums as the day close (a one-day period equals that day's close totals); refunds are shown next to gross, never netted; liability to sellers and open payouts are current, not per period. Any member may read it, agents through `komisio_read_economy_summary` under `economy:read`. A brief is a rendering of this read, never a stored fact. No new table.

- 2026-09-13: Live Zettle purchase pull is an explicitly activated, owner/admin pilot capability bound to both tenant and verified merchant. Activation freezes the server cutover time; no historical backfill. Append-only integration windows/pages retain provider pagination separately from the legacy aggregate sync cursor. Each bounded manual call imports one page through existing receipt reconciliation; an empty page completes the window. Subsequent windows overlap five minutes, lag server time by two minutes and cover at most one day. These are operational reconciliation choices, not financial rules or guarantees about indefinitely delayed provider data. Unknown/unsupported receipts stay held. No worker, product export, inventory mutation or new core financial table in this slice.
- 2026-09-13: Store profile (P3, Fable): the store's public text (address, contact, opening hours, what it accepts, concept, language) is one versioned document in `store_profile_versions`, published by owner or admin naming the current version; every version stays. It is public by definition: `public_store_profile(slug)` is readable anonymously and returns nothing but name, slug, version and the document. The staged kind `updateStoreProfile` (low) lets an agent propose the next version; publishing still executes only for an owner or admin approver. No CMS, no translations register: translation on read is a later adapter.

- 2026-09-13: Concurrent local work allocated migration15120000 to both Fable store profile and unmerged Zettle pull. Staging already has Fable15120000. Preserve both SQL bodies unchanged and assign the unreleased Zettle file15123000. After verifying both schemas locally, repair only local migration bookkeeping to represent both applied migrations; no domain rows or staging migration history are rewritten.
- 2026-09-13: Pilot gates (Fable): a structural pgTAP sweep asserts row level security on every public table, an explicit allowlist of anonymously executable functions (the public profile read and the two storage hooks), no table privileges for anon or public, select-only grants for authenticated, invoker views, and zero cross-tenant rows for a seeded tenant; a new table or function that breaks any of these fails CI. `seller_data_export` returns every row about one seller for the owner or an admin, logged as an access event; retention and erasure stay a per-case owner decision until a retention policy is written. `npm run backup:exercise` is the restore exercise for the local and self-hosted stack; hosted restore is a Supabase project action the owner performs.

- 2026-09-13: Planned live pilot catalog export initializes at most one stock unit per accepted item. Before any inventory mutation the engine commits a unique append-only stock intent; only the winning invocation may send the increment, never a replay. Retries observe remote tracking and stock; an ambiguous zero or externally changed state remains held instead of restocking. The movement identifier is correlation only. Mandatory tenant/merchant pins, current item/policy/price checks and explicit POS VAT mapping remain. A single STORE inventory must be unambiguous. This manual pilot slice does not implement returns/restocking, lifecycle delisting or scheduled exports; those remain required before an external pilot. No financial calculation is changed.

The first stock slice supplies only a disconnected HTTP adapter and stock evidence classification. The durable engine claim, database authorization tests and UI wiring are still pending; no inventory mutation is enabled by this slice.

- 2026-09-13: Self drop-off (P3, Fable; owner approved the new core table): a seller announces a handover from the portal under its own verified identity and gets a reference; the store receives it through `receive_handover`, which records the ordinary bag receipt under the current agreement rules, so custody, inspection and everything downstream are unchanged. Enabled per store only when the policy's custodySources contains seller_dropoff; locker custody additionally needs locker in the policy. The announcement is immutable, status moves only in the engine, events are append-only. No locker hardware, QR rendering or seller-side item registration in this slice.

- 2026-09-13: The live one-item export command uses an immutable stock intent unique per tenant/item. Only a newly committed claim may enable tracking or submit the initial unit; all replays reconcile read-only stock. Current export snapshots are checked before remote product writes and immediately before a stock movement. Reconciliation evidence is stored as append-only integration outcomes; no seller financial rule changes. A manual refresh can update price through conditional product export without replenishing inventory. No scheduler, restocking or delisting is enabled.
- 2026-09-13: Markdown agent (answer to open question 4, owner "run the proposal"): the store policy's markdown steps are the only schedule and stay frozen per item at acceptance; a per-item deviation is the existing manual price change. `automaticMarkdowns` (optional, off by default) lets Komisio apply due steps once a day per store, acting as the owner or admin who published that policy version, recorded as an immutable `markdown_runs` row and as the ordinary markdown event on each item; the same run is available to staff by hand. No notice per step; the existing unsold notice stays. Scheduling is a pg_cron job where the extension exists (hosted); the run function is executable by the database owner only.
- 2026-09-13: Derived identifiers are RFC 4122 shaped: `komisio_private.derived_id(key)` keeps the md5 bytes of the key but sets version 5 and variant 8, and the application derives the same bytes. Raw `md5()::uuid` is not used for ids any more: the browser journeys showed that the application's UUID validation rejects such ids, which made the payouts and handover pages fail after a batch or a receipt. Found by the P3 browser journeys; the pgTAP files had asserted the same raw shape and passed.

- 2026-09-13: Product export failures retain only allowlisted adapter codes in immutable outcomes and the UI. No raw provider response, token or arbitrary exception text crosses that boundary. Product errors are distinguished from stock initialization; stable product IDs and conservative remote-field checks remain unchanged.

- 2026-09-13: Product Library requests use the verified merchant UUID explicitly, as specified by the current Product Library reference, rather than relying on the self alias. An unexpected product-read status is retained as a safe HTTP status and finite keyword hints, never raw provider details. No product/variant identity is rotated and no stock or financial rule changes.

## 2026-09-13: Zettle provider identity compatibility and rejected-ID recovery

Declare the existing Supabase uuid-ossp extension as an explicit database dependency.
Generate Product Library product/variant IDs with PostgreSQL uuid_generate_v1mc
(random multicast node), matching the provider examples. Internal item IDs stay
unchanged. Live product GET rejected our v4 ID with HTTP 422 and a UUID error;
the current OpenAPI only says UUID, so this is an observed compatibility fix,
not a claim that every Zettle API rejects every other UUID version.

An owner/admin export may replace a rejected v4 product identity only after a
pre-write GET returns 422 with a UUID-specific error, with no prior acknowledged
export, stock intent or sale. Append a successor export linked to the rejected
snapshot; never edit old IDs or outcomes. The tenant lock serializes recovery,
replays return the same successor, and later snapshots reuse its IDs. One bounded
retry is allowed. Network failures, write/read-back errors, valid v1 identities,
and any ambiguous existing product stay held; none authorize ID rotation.

## 2026-09-13: Zettle read-back is distinct from update safety

Normalize the provider's decimal-string VAT percentage to the existing bounded
numeric contract on read only; outbound engine payloads remain numeric. A product
GET now succeeds with v1 IDs but real read-back fails at vatPercentage; historical
official Product Library examples also use decimal strings. Reject empty,
non-decimal, non-finite and out-of-range values.

Reading an exact managed-field match performs no product write, so provider
metadata need not block create read-back or a lost-acknowledgement retry. Before
an actual update, retain the existing conservative guard against unmanaged
fields, verify the previous managed snapshot and require ETag. This does not
copy or erase remote descriptions, categories, images or variant options.

## 2026-09-13: New-product tracking and physical stock evidence

An empty successful tracking-status list provides no enabled tracking record.
Treat it as not enabled; validate at most one correctly bound status row. Fresh
initial attempts may explicitly enable tracking. Existing durable claims still
cannot re-enable tracking or submit another movement automatically.

Use the actual STORE balance to check stock availability. Zettle documents balance
retrieval for STORE inventories; SUPPLIER is an infinite virtual source, not an
expected negative stock counter. Do not invent balances for SOLD/BIN/SUPPLIER.
One in STORE is available, zero remains unknown on replay (never replenished),
and other values conflict with the single-item pilot. Sales continue to come
from matched Purchase API facts, never inferred from zero stock. The durable
single initial movement claim and current item/policy guards remain unchanged.

References: [fetch balances](https://developer.zettle.com/docs/api/inventory/user-guides/manage-inventory-balances/fetch-inventory-balance)
and [inventory concepts](https://developer.zettle.com/docs/api/inventory/concepts/how-inventories-work).
Old unknown attempts require explicit reconciliation; this patch does not erase
claims or authorize another initial movement for them.

## 2026-09-13: Zettle review follow-up

Receipt page validation accepts the half-open interval from five minutes before
the requested window start to five minutes after its end, never before the
connection's immutable activation cutover. This bounds provider timestamp skew
without historical backfill. Pagination, whole-receipt reconciliation, actor
checks and receipt idempotency remain unchanged; timestamps outside this
tolerance still fail closed. No window is silently skipped or closed.

Retain `recordZettlePurchase` as a compatibility-only staged kind for existing
envelopes. Do not add new proposals or treat it as a force-record escape for held
receipts; all existing validation and approval requirements remain in force.
Scheduled retrieval is a separate slice: follow the markdown worker's private,
database-owner-only execution pattern with the enabling connection owner/admin
as actor, rechecking current authorization. No service-role client.

- 2026-09-13: One currency per store (owner decision). The store policy names it (`currency`: SEK, NOK, DKK or EUR; absent means SEK), chosen at onboarding and frozen by `publish_store_policy` once the store has recorded a sale, a purchase or a payout (`CURRENCY_FROZEN`). Every money fact records the store's currency: `record_sale` refuses another (`CURRENCY_MISMATCH`), payouts and purchases take it from the store, a reception review's price must name it, a Zettle receipt in another currency is held. Amounts stay integers in the currency's minor unit; Komisio converts nothing and a store holds no second currency in version 1. Pages, e-mails, labels and agent tools show the store's code instead of a fixed SEK.
- 2026-09-14: Price evidence (P3, Fable): `price_evidence(tenant, category, text, days)` returns the store's own comparable sales (accepted price, sold price, days to sale, markdowns, median and range), returned items excluded, from the store's facts only. It is evidence a person or the reception agent cites in a price rationale, never a price and never a suggestion; cross-store comparison waits for an explicit opt-in design. Shown on the inspection and reception pages and as `komisio_read_price_evidence` under `reception:read`. No new table.
- 2026-09-14: Fortnox connection (P3, Fable): one Fortnox company per store, connected by the owner or an admin through OAuth (authorization code, offline access, scopes `companyinformation bookkeeping`). Tokens are sealed on the server (AES-256-GCM under `KOMISIO_CREDENTIAL_KEY`, purpose-bound) and stored through `store_fortnox_connection`; the table has no grant, so the ciphertext is reachable only through `read_fortnox_connection` (owner or admin). The company is verified against the pinned name (`FORTNOX_EXPECTED_COMPANY_NAME`, mandatory) and database number (`FORTNOX_EXPECTED_DATABASE_NUMBER`, once known) before a token is stored, and again on every check; a mismatch is recorded as a refusal without the token. The organisation number is never a pin because a Fortnox test company can share it with the production company. Every connection change is an append-only event. Nothing is written to Fortnox by this slice; voucher sending is a later slice that requires the database pin.
- 2026-09-14: Fortnox voucher sending (P3, Fable) and pin relaxation (owner decision): `FORTNOX_EXPECTED_DATABASE_NUMBER` is optional because the Fortnox consent screen makes the company choice explicit and the stored connection is bound to its database number; the name pin stays mandatory. One recorded export becomes at most one voucher: `begin_fortnox_send` opens a send bound to the connected database (one live send per export, ten-minute stale window), the server refuses when another database answers, `POST /3/vouchers` carries exactly the recorded lines (series A, close date, tenant accounts, kronor with two decimals), `complete_fortnox_send` records sent (series, number, year) or failed (reason, Fortnox message). Sent rows are immutable and never resent; failed ones may be retried as new rows. Only SEK stores send in version 1. Owner or admin sends; members read the log.
- 2026-09-14: Economy brief (P3, Fable): the weekly and monthly brief is deterministic. `economy_brief(tenant, kind, anchor)` returns the economy summary for one calendar period (ISO week Monday to Sunday, or calendar month, Europe/Stockholm) and the period before, the best selling day and items accepted; `renderBrief` turns it into fixed sentences in the reader's language. No model writes it, no forecast is made, nothing is stored; every read recomputes from the facts. Any member reads it on the economy page; agents read it under `economy:read` as `komisio_read_economy_brief` with the numbers in öre next to the sentences.
- 2026-09-14: Accounting reconciliation (P3, Fable): `accounting_reconciliation(tenant, from, to)` reports, per active local day, where the books stand between the facts, the day close, the export and Fortnox, using the day close's own totals to detect a stale close and the current map to detect an outdated export. It is a read for any member and for agents under `accounting:read`; it changes nothing and proposes nothing. The accounting page lists the days needing attention for a period.
- 2026-09-14: Owner decisions on the consolidated list (docs/OWNER-ACTIONS-2026-09-14.md). **D1 automation actor**: one automation identity per deployment (an ordinary Auth user whose password is a server secret), a fifth tenant role `automation` that only that identity can hold, granted per store and scope by an owner (`enable_automation`), accepted by the identity itself (`accept_automation_grants`, which creates the membership), removed by `disable_automation`; functions that automation may call check `komisio_private.automation_allowed(tenant, scope)`; member administration never touches the role; Vercel Cron is the trigger; no service key, no borrowed session (migration `20260916020000`, docs/AUTOMATION-ACTOR.md). **C1–C6 plans**: hosted Komisio is one plan at SEK 199 per store and month excluding VAT, 30-day trial from store creation, 14-day grace after a failed payment, read-only blocks new facts (reception, sales, markdowns, payout requests, agent proposals) while reads, exports and marking approved payouts paid stay open, Stripe Checkout and portal with card and invoice, production at `app.komisio.com` under the operating company, one working day on staging before production and the owner approves production migrations (docs/ONBOARDING-AND-PLANS.md). **B1 retention**: seller contact data stays while the seller has items, a balance or an open statement; anonymised on request or 24 months after the last activity; financial rows seven years. **B2 lost MFA device**: no self-service; the store owner verifies the person, an operator removes the factor in the Supabase dashboard and logs it, the person re-enrols. **B3 account deletion**: contact fields anonymised and memberships revoked; audit and financial references stay. **B4 intake convergence**: assumptions A1–A4 confirmed (staff-attested custody for wall garments, one tenant policy for the agreement prerequisite, seller approval as item-level evidence, shared category and condition). **A1, A5**: owner performs the Vercel deploy hook and the Resend configuration.
- 2026-09-14: Plans slice 1 (Fable, per C1–C6): billing is a deployment switch (`platform_settings.billing_enabled`, off by default, turned on once by the operator with `komisio_private.enable_billing`, which also keeps every existing store active on a manual plan). With billing on, store creation starts a 30-day trial; a daily run turns expired trials, grace periods and dated manual activations into `read_only`; the owner may close a store. Read-only is enforced by one SQL gate (`komisio_private.require_writable`) as a before-insert trigger on the fact tables, so the interface, agents and integrations cannot differ; roles and RLS are untouched and reads, exports and marking approved payouts paid stay open. Platform hosts are rows in `platform_hosts`; they see every store and may activate one manually with a recorded reason; a closed store is not reactivated by a host. No payment provider yet.
- 2026-09-14: Plans slice 3 (Fable, per C4): Stripe owns prices, tax, invoices and the customer portal; Komisio calls Stripe over plain fetch (no dependency) for hosted Checkout and portal sessions, and records webhook outcomes once per event id through `record_billing_event` as the billing actor (the automation identity registered by the operator as a platform host of kind `billing`; person hosts and the billing actor cannot do each other's work). Outcomes: checkout completed or invoice paid → active; payment failed → past_due with 14 days grace from the first failure; cancel at period end → active until the date, then read-only by the daily run; subscription deleted → read-only; an owner-closed store never changes state from a provider event; unknown ids are recorded as unmatched.
- 2026-09-14: Trial notices (Fable, plans slice 2): owners get one e-mail per step (a week before the trial ends, the day before, when the store becomes read-only, and a week before a payment grace ends), fixed wording in the owner's language, sent by the billing actor from a daily Vercel Cron through the allowlisted pilot transport, recorded once per store and kind in `plan_notices`. No e-mail goes to sellers or staff; a store without an owner address is recorded, not retried.
- 2026-09-14: Weekly brief by e-mail (Fable): an owner switches it on per store as an automation grant with scope `weekly_brief`; the automation identity reads the store's economy summary and brief under that scope only and mails last week's fixed sentences to the owners every Monday through the allowlisted transport, recorded once per store and week. No other read opens to the scope; disabling the grant closes the reads at once.
- 2026-09-15: Agent reads of items and receipts (P2, Fable): `items_overview(tenant, text, stage, limit)` lists accepted items newest first with the title and category their origin holds (inspection draft, reception review or purchase note, through `komisio_private.item_title`), the derived lifecycle stage, the current price and when they sold; text matches anywhere in title or category with literal wildcards, and stage is the engine's stage. Any member reads it; it powers the search on the items page and `komisio_find_items` under the new `items:read` scope, with `komisio_read_item_summary` (frozen terms, price series, event kinds; free-text reasons and details omitted). Receipts are read through `komisio_find_receipts` and `komisio_read_receipt` under the new `sales:read` scope over the existing sale reads (optional provider, exact external id and status). Seller ids only, never names or contacts; the MCP still exposes no seller lookup. Read scopes stay separate from the proposal scopes. No new table.
- 2026-09-15: Plan price presentation (owner correction of C1): SEK 199 per store and month is quoted excluding VAT. Stripe applies Swedish VAT on the invoice; komisio.com and the product's plan texts say "excluding VAT". No code change: the price and tax live in Stripe.
- 2026-09-15: Price proposal per item (P2 agent tools, Fable): `komisio_propose_price_change` under `lifecycle:propose` stages the existing `bulkItemUpdate` kind with one item at medium risk, so a different person approves and the preview shows the current price. The agent must cite the price evidence it read (category, query, days, count, median); the tool re-reads that evidence and refuses a citation that no longer matches (`EVIDENCE_STALE`), and the citation is recorded in the operation's reason. No new kind, no new table; evidence remains evidence, never a price.
- 2026-09-15: Chains (owner answers to docs/CHAIN-GROUPING.md). (1) A chain is a label above stores: `chains` and `tenants.chain_id`, set only by `create_chain`, `join_chain` and `leave_chain`, which require the caller to be owner of the store being grouped (and, for joining, owner of a store already in the chain); a direct update of the label is refused by trigger. `chain_overview` shows members the chain and its stores; `chain_economy_summary` reuses `economy_summary` per store and sums the totals for a caller who is owner or admin in every store of the chain, with no total when currencies differ. Isolation, membership and plans stay per store. (2) When items move between stores (later slice), the seller's balance stays in the store where the sale happened. (3) The target store accepts a transferred item under its own policy and terms. (4) Only an owner or admin in both stores may move an item. (5) Each store keeps its own 199 kr plan.
- 2026-09-15: Item transfer within a chain (step 2 of docs/CHAIN-GROUPING.md, Fable): `transfer_item(from, item, to, id, note)` requires owner or admin in both stores and the same chain; it ends the consignment item's period in the source with action `transfer` (the event carries the target ids, so a replay by id returns the same result), finds or copies the seller in the target by e-mail or phone, and receives a bag there with one inspection draft carrying the item's title and category. The target accepts under its own policy and terms, including its own agreement evidence; the seller's balance stays in the source store. Store-owned items are not transferred by this slice. No new table.
- 2026-09-15: Stock report (P3 reports, Fable): `stock_report(tenant, from, to)` gives, per category and in total, items in stock now (no completed unreturned sale, no period end) at current price with age in four buckets that follow the default markdown schedule, items sold in the period with gross, the store's margin (commission for consignment; price minus VAT minus purchase price for store-owned), margin percent, sell-through (sold over sold plus in stock) and average days to sale. Shown on `/intake/stock` and readable as `komisio_read_stock_report` under `economy:read`. Definitions in docs/STOCK-REPORT.md; no new table.
- 2026-09-15: Shopify adapter, step 1 (Fable, per B9): one Shopify shop per store, connected through the authorization code grant of a Komisio app registered in Shopify's Dev Dashboard (merchant custom apps are no longer offered by Shopify). The shop's myshopify domain is named by the owner, verified through the `shop` query on Admin API 2026-07 and pinned; tokens are sealed with the server-side credential key; every step is an append-only event; a direct update or delete of the connection is refused. Same shape as the Fortnox connection (`20260916290000`). Products out and orders in follow in docs/SHOPIFY-ADAPTER.md; no real shop is connected until the owner registers the app (A11).
- 2026-09-15: Seller import (P5 import wizard, first slice, Fable): a CSV parsed in the browser, columns mapped by a fixed header list and the person, a preview, then one staged kind `importSellers` (file name and at most 200 rows) whose approval registers every row through `register_seller` as the approver and skips rows whose e-mail already belongs to a seller of the store, recording created and skipped counts. Low risk, so the person who staged it may approve; the payload is the provenance. Items, balances and agreements are not imported; a model-proposed mapping and the MCP import tools follow behind the same review. No new table.
- 2026-09-15: Seller portal, my items (owner request, Fable): `my_items(tenant, seller)` under the portal's own identity check lists the seller's accepted items with the origin's title and category, current and accepted price, the engine's lifecycle stage shown as five plain states (for sale, sale period ends soon, sale period over, no longer for sale, sold), the period end and what the store does then, and the sale date and price when sold. No photos, no condition, no staff notes; newest 200. Same facts as the staff lifecycle queue.
- 2026-09-15: Shopify adapter, step 2 (Fable, per B9): an accepted item for sale is one Shopify product with one default variant, sku `K-<item id>`, current price, one tracked unit at the shop's first active online location, no photo yet. Intent (`shopify_product_exports`, one per item and price) before the request, outcome (`shopify_product_outcomes`: synced with ids, failed, unknown) after; both immutable. Never two products for one item: a known product id is updated, otherwise the sku is looked up in the shop before creating, and a duplicate sku stops the export. A markdown is a new export that updates the same product. Expiring tokens are renewed before use and stored against the connection revision; a changed revision refuses the store. Sold and ended items are never offered.
- 2026-09-15: Shopify adapter, step 3 (Fable, per B9): paid orders are pulled one page at a time from a stored watermark (the connection time, then the newest update seen), stored once per order as immutable evidence, and recorded as a sale through `record_sale` (provider `shopify`, order id as external id) only when every line is a Komisio item by sku, one unit each, in the store's currency, paid, not cancelled and not a test order. Everything else is held with a reason for a person; an engine refusal is an outcome row that can be retried; an order changed in Shopify after storage is flagged once. No refunds as returns and no scheduled pull yet.
- 2026-09-15: Shopify scheduled order pull (Fable, per D1): a fourth automation scope `shopify_pull` that an owner enables per store; every quarter hour the automation identity pulls one page of paid orders through the same page function as the button, one reserved run per store and quarter hour, outcome `received`, `complete` or `failed` bound to what was recorded. The scope opens the sealed connection read, token renewal, the watermark, page recording and the private sale core; it opens no export, check, disconnect or retry. Only the pilot store runs until the owner widens it.
- 2026-09-15: Shopify refunds and photos (Fable, owner request "kör klart med Shopify"): a Shopify refund line on a sold Komisio item is a return of that sale line under the existing return rule (whole line, once), recorded through a new private return core that the public `record_return` wraps unchanged; partially refunded and refunded orders count as paid for the sale; refunds the rule refuses or that match no sale line are held with the code, never silently dropped. The first reception photo becomes the product image once per item through Shopify's staged upload; a failed photo never fails the export.
- 2026-09-15: Production path (Fable, per C5/C6): production migrations run only from a workflow the owner dispatches on main and approves in the protected `production-database` GitHub environment, through the same dry-run, apply and verify path as staging; a push can never reach production. The hosted environment guard accepts `production` only with an own domain, real invitation e-mail, an own credential key, cron secret and automation identity, and no staging-only switch. Promotion is by code after the staging soak; no data moves between environments.
- 2026-09-15: Intake profiles (owner: "1. JA, 2. JA"): the store policy carries `intakeProfile` (quick, standard, full; absent means quick, the default for new stores). Quick reception is one screen per garment (seller, photo, facts, price, label) backed by `quick_receive`, which chains the existing engine steps in one transaction: source revision with the staff's price evidence, review under the current agreement, custody, acceptance. Every rule of those steps still applies (agreement evidence, per-item seller approval when chosen, one item per session, replay by request id); nothing is bypassed. Full keeps the step-by-step reception; standard (hold for the seller's price approval) is accepted by the policy and delivered in a follow-up. See docs/QUICK-INTAKE.md.
- 2026-09-15: Label sizes per store and kind (owner request): `label_formats` holds width and height in millimetres per label kind, set by owner or admin under Settings, Printing; defaults 76 x 51 mm for bag and onboarding labels and 57 x 32 mm for garment, item and markdown labels apply until a store chooses. The template version `zpl-v2` scales the fixed layout to the size at the printer's resolution; the rendered program stays with the print job. Custom ZPL per store (as legacy Komisio allowed) is not offered: the layout stays code so a label can never carry a foreign program.
- 2026-09-15: Print devices (owner: the store must only install and enter a code): the computer at a printer is its own anonymous Supabase user with the sixth tenant role `device`, bound to one printer through a one-time pairing code (hashed, fifteen minutes) that an owner or admin creates in Settings. A device is outside the member tenant list, so every row-level policy denies it; it reads its printer, claims and completes that printer's jobs and reports a heartbeat through functions, nothing else; revocation removes the membership. Anonymous sign-ins are enabled on the projects for this purpose only. Komisio Print for Windows is built by CI as a dependency-free Node single executable wrapped by WinSW and published as a release asset; the developer script with tokens is retired.
- 2026-09-15: Store label templates (owner request, the ZPL editor of legacy Komisio; supersedes the 'not offered' stance of the label-size decision): an owner or admin may write the ZPL program per label kind with placeholders; values are always sanitised, the program must be one label carrying the reference, printer control commands are refused, versions are append-only and the built-in layout is one click away. Previews render sample data only, through Labelary.
- 2026-09-15: Label configuration step 2 (owner, on Fable's proposals): the label size stays per kind and is never overridden by a printer-bound template; the automatic print rule for item labels fires on every acceptance, including the target store's acceptance of a chain transfer. Built by Astra per docs/ASTRA-SPEC-LABELS.md.
- 2026-09-16: Free core and Butik Plus (owner, "alternativ 5"; supersedes the read-only gate of the plan decision C3): the hosted core is free with a cap of 100 accepted items per calendar month and one paired print device; Butik Plus at SEK 199 a month excluding VAT per store removes the cap, allows five devices and holds Shopify, Fortnox, chains and transfers, and the reception assistant. A trial is 30 days of Plus; an ended trial, a lapsed grace or a cancelled subscription drops the store to the free core, never to read-only. Every limit is enforced in SQL (`plan_tier`, `require_plus`, the item count in `plan_gate`, the device count in pairing) and reported by `plan_status`. Self-hosted and stores created before billing was enabled are Plus. See docs/PLANS-FREE-CORE.md.
- 2026-09-16: Free core and Butik Plus (owner, "alternativ 5"; supersedes the read-only gate of the plan decision C3): the hosted core is free with a cap of 100 accepted items per calendar month and one paired print device; Butik Plus at SEK 199 a month excluding VAT per store removes the cap, allows five devices and holds Shopify, Fortnox, chains and transfers, and the reception assistant. A trial is 30 days of Plus; an ended trial, a lapsed grace or a cancelled subscription drops the store to the free core, never to read-only. Every limit is enforced in SQL (`plan_tier`, `require_plus`, the item count in `plan_gate`, the device count in pairing) and reported by `plan_status`. Self-hosted and stores created before billing was enabled are Plus. See docs/PLANS-FREE-CORE.md.
- 2026-09-16: Hosted MCP connector (owner direction; Fable's design, see docs/HOSTED-MCP.md): Komisio is the OAuth 2.1 authorization server for its own MCP endpoint (`/api/mcp`); assistants register as public clients, a member approves one store and a set of scopes on a consent page, and tokens are opaque secrets stored as hashes (access one hour, refresh thirty days, rotated; a replayed code or refresh token voids the grant). Every tool call is one `connector_call` in SQL that binds the store, requires the function (and operation kind) to be listed under a scope of the grant, sets the request claims to the approving person with the recorded assurance level, checks the person is still a member, and calls the unchanged engine function; proposals name the person, so the four-eyes rule holds. No service key and no Supabase JWT are involved. The connector is a Butik Plus feature; `reception:photos` is not a hosted scope; tools whose reads use table access stay local until those reads are SQL functions.
- 2026-09-16: Open core and AI credits (owner; supersedes the free core with item cap and Butik Plus of the same day): Komisio is free and open source, also hosted by Inority; no plan, no item cap, no device cap, and Shopify, Fortnox, chains, the assistant and the hosted connector are open to every store. Swish payouts carry no service fee. The only metered resource is the assistant's model usage on the host's own key: a store gets an included monthly amount of AI credits (one credit = one krona, default 100), buys packs (default 100 for SEK 100) or connects its own OpenAI key and is then never metered. A platform-wide monthly cap on the host's own model spend (default SEK 2 000) is never exceeded; purchased credits do not count against it. Reservation before the call and settlement to the actual token cost after it are rows in `ai_credit_events`; balances, the cap and the estimate of items per included month are computed in SQL. Public figures on the product page come only from real usage of stores the host lists anonymously (`store_showcase`), never from invented examples. See docs/PRICING.md.

## 2026-09-16: Fixed local prices for AI credit packs

Owner approved staging/test-mode one-time prices for the same 100 credits:
100 SEK, 100 NOK, 65 DKK or 9 EUR. Currency follows the versioned store
profile country: SE/NO/DK select their currency, other supported European
countries select EUR. Legacy Swedish pilot profiles without country keep SEK.
The internal credit balance remains SEK-denominated (10,000 ore per pack);
payment minor units never determine the granted credits. Missing currency
configuration blocks checkout rather than silently charging another currency.

- 2026-09-16: Eight product languages (owner request): the application speaks Swedish, English, Norwegian, Danish, Finnish, German, Spanish and Italian, the languages of komisio.com. `lib/i18n.ts` holds the list; every dictionary file carries the full Swedish shape and the unit test refuses a missing key; the browser cookie wins over the profile, then Swedish. Dates and amounts format with the locale's BCP 47 tag. Profile locale, seller agreement language, seller communication locale and store profile language accept the eight codes (migration `20260916470000`). Fixed e-mail templates (seller messages, invitations) remain in Swedish and English; other locales receive English there until translated. The six new dictionaries were machine-translated from English and are to be proofread by native speakers before those markets open.
- 2026-09-16: Open e-mail delivery with a host cap per store (Opus, after the open-core decision): the deployment's allowlist may be `*`, which delivers to any recipient the engine already authorised, so a store that registers by itself can invite colleagues and notify its sellers without an operator. The pilot's exact-address list stays valid and an empty list still delivers nothing. The abuse boundary moves from an environment variable into the engine: `queue_seller_communication` and `create_invitation` refuse with `EMAIL_DAILY_CAP` and `INVITE_DAILY_CAP` when the store has reached the host's rolling-day number (defaults 1000 messages and 25 invitations), counted per store and never settable by the store. A refused call writes nothing and can never roll back a sale, a payout or a statement, because messages are queued outside those transactions. Migration `20260916480000`, pgTAP `0115_email_caps`.
- 2026-09-16: Detail reads are engine functions (Opus): one item with its prices and events, the receipt list, one receipt with its frozen lines, a seller's ledger page and the day close list moved from table access into `item_detail`, `sales_page`, `sale_detail`, `seller_ledger_page` and `day_close_page` (migration `20260916490000`). The hosted connector can only reach SQL functions, so these five reads were invisible to a store's own assistant; the web now calls the same functions and the same store-role check the row-level policies applied. Five tools left `hostedExcludedTools`; the reception and inspection reads stay local until their own reads move, and the photo read never can, because a connector cannot reach storage.
- 2026-09-16: A call cap per connector grant (Opus): `connector_call` refuses with `CONNECTOR_RATE_LIMIT` once a grant has made the host's number of calls in a rolling day (`connector_daily_cap`, default 2000, migration `20260916500000`). The MCP endpoint is internet-facing and a token buys unlimited reads, so one store's runaway assistant could saturate the database every store shares. The number stops a loop, not a conversation, and a refused call is not recorded, so it cannot deepen the hole. Same shape as the e-mail caps: a platform setting the host owns, never the store.
- 2026-09-16: Two connector registrations, no new reads (Opus): `reception_queue` under `reception:read` and `item_detail` under `lifecycle:propose` as well as `items:read` (migration `20260916510000`). Both functions existed, both already check the caller's role and store, and both tools read through them only; they had been excluded with the rest of the reception and pricing surface and never re-examined. Without the first, an assistant that may read receptions can open the one a person names but cannot see which ones are waiting, which is most of the value. Without the second, a price proposal refuses on its own first read, so a store would have to grant a read scope for a proposal it had already allowed. Nothing is exposed that a scope did not already cover: `komisio_list_receptions` and `komisio_propose_price_change` left `hostedExcludedTools`, leaving eleven, and a grant without the two scopes still reaches neither function (pgTAP `0117_connector_reception`).
- 2026-09-16: One reception is an engine function (Opus): `reception_session_detail` returns the session, its seller, the current revision and that revision's sources in one call (migration `20260916520000`), replacing the two table reads in `readReceptionSession`. The web reads exactly what it read before under the same store-role check; a session with no sources yet returns revision 0 and no sources, which is how a reception starts, and an unknown session is null rather than an error. Three tools left `hostedExcludedTools` with it, leaving eight, and the function is registered under `reception:read`, `reception:preview` and `reception:propose` because each tool asks for its own scope. The staged review also needed `propose_operation` under `reception:propose` for the kind `publishReceptionReview`: that scope reached no proposal kind at all, so the tool would have refused at its last step. pgTAP `0118_reception_detail`. What remains local is the inspection surface, the reception history and the photo read, which no connector can ever serve because the bytes live in a storage bucket.
- 2026-09-16: The bag queue is an engine function (Opus): `bag_queue_page` lists a store's received bags with the seller name embedded, filtered by seller or reference and walked by an older or newer cursor (migration `20260916530000`), replacing the table read in `readBagQueue`. Same rows, same order and the store-role check the row-level policy applied; twenty-one rows are still returned so the caller decides from the twenty-first whether a further page exists, which is cheaper than a count, and both cursors at once is `INVALID_INPUT` rather than a silently ignored filter. Registered under `reception:read`, so `komisio_list_bags` left `hostedExcludedTools`, leaving seven. pgTAP `0119_bag_queue_page`.
- 2026-09-16: Opening a new store can be closed to named countries (Opus, owner request): `KOMISIO_BLOCKED_SIGNUP_COUNTRIES` is a comma-separated list of ISO 3166-1 alpha-2 codes, and `proxy.ts` refuses `/register` and `/onboarding` from those countries with 403 and an address to write to. It is a filter on noise, not an access control: a VPN passes it in seconds, and the sign-up call itself goes from the browser to Supabase without touching this code. What it stops is the drive-by registration that never becomes a store, which is the traffic the owner reported. Deliberately narrow: signing in, running a store and every seller page stay open from everywhere, so an owner who travels is never locked out of their own shop. Unset or empty blocks nothing, and an unknown country is allowed, so self-hosting and local development are unaffected. Unit test `tests/unit/signup-countries.test.ts`.
- 2026-09-16: A lower e-mail ceiling while a store is new (Opus, after the owner questioned 1000 a day): `email_new_cap` (default 50), `invite_new_cap` (default 5) and `email_trust_days` (default 7) in `platform_settings`; `queue_seller_communication` and `create_invitation` choose the new-store number while `tenants.created_at` is inside the window and the established number after it (migration `20260916540000`). Registration is open and a store may write to any address its staff type in, so the old flat caps let a throwaway store send a thousand messages from the deployment's verified sending domain on its first day. The money was never the risk; the sending reputation is, because a blocklisted domain stops every real store's seller notices at once. A real shop is unaffected: in its first week it has a handful of sellers. `email_trust_days` of 0 restores one number for every store. All five belong to the host under Plattform and no store can change its own. pgTAP `0120_new_store_caps`.
- 2026-09-16: Built-in assistance is on by default for a new store (owner decision, replacing the P1 S9 default of off): the fallback store policy carries `assistanceEnabled: true` (migration `20260916550000`, `skills/consignment-sweden` default table, `defaultStorePolicy()`). A new store met the reception screen with the AI button inert and nothing explaining why; assistance is the part of Komisio that saves a shop time and every store has included credits to try it with. Only the fallback changed. A store that has published a policy keeps exactly what it published, and since the key was absent there assistance stays off for it until its owner publishes again with the box ticked; nothing published is rewritten. The default is not an authority to spend: a person starts every analysis, the deployment must have a model configured at all, the store's monthly quota applies, and the credit reservation and platform cap are unchanged. An owner can untick it and publish. The fallback is written out in both `public.current_store_policy` and `komisio_private.current_store_policy_core`, which must agree, so both are replaced. pgTAP `0121_assistance_default`.

<!-- one-line rule from 2026-09-17: entries below are at most 300 characters -->

- 2026-09-17: Reasoning belongs in the pull request and the decision is one line here (owner, from a sibling project's practice): entries below the marker are at most 300 characters and a unit test enforces it; writing reasoning into fresh docs/ files grew 97 documents in a week.
- 2026-09-17: The hosted platform is open for real stores (owner): e-mail delivery opened, the OpenAI reception assistant live in both environments with credit metering verified at 2 öre per image, new stores closed to IN and CN, and Komisio Print published as print-v1.0.1.
- 2026-09-17: Inority hosts Komisio for three months at no cost, then SEK 299 per store and month excluding VAT with no lock-in (owner): the software stays AGPL-3.0 with no licence fee, self-hosting and any other hosting partner remain equal options.
- 2026-09-17: BankID leaves the documents (owner): the roadmap promises no verified identity at all, since the scheme differs by market and the providers charge per use; the disclaimers that a review link is not a legal identity stay, generalised.
- 2026-09-17: A chain transfer carries the item's condition (Opus): item_title now returns it from both origins and transfer_item writes it into the target draft, so a caveat like a torn cuff is not lost when an item moves between stores of one company.
- 2026-09-17: Category, item type and attribute are three concepts, not one (owner, after review): a type decides which questions to ask and only suggests a category; definitions are versioned so editing a setting cannot change what a past observation meant. Migration 20260917110000.
- 2026-09-17: A reception review carries an attribute list and the seven fixed keys are derived from it (Opus): the list is authoritative, an observation binds to a definition version, and only attributes bound to a definition the store can see may be published. Migration 20260917120000.
- 2026-09-17: Quick reception asks the questions the item type decides (Opus): the facts map is slug to value for any attribute the store's vocabulary defines, the form renders the profile, and a lamp records its socket where a sweater records its size. Migration 20260917130000.
- 2026-09-17: An attribute correction is a new row, never an edit (Opus): the item keeps the origin revision the seller approved, item_attributes overlays the latest correction per slug and returns the accepted value beside it, so stock shows L while the approved review still says M.
- 2026-09-17: A chain transfer carries the whole description (Opus): the inspection draft holds an attribute list, the seam prefers it, and transfer_item copies every attribute the target store's vocabulary also defines. Colour, brand, size and material stop being lost.
- 2026-09-17: Staff confirm attributes, not seven fixed names (Opus): the fact review reads the attribute list where a candidate has one, so a lamp's socket can be confirmed rather than travelling unseen while only a description is reviewed.
- 2026-09-17: Every descriptive read goes through the attribute list (Opus): item_title asks item_attributes instead of branching on origin, so a corrected category groups the stock report and a corrected description titles the item list. Migration 20260917160000.
- 2026-09-17: The seller sees everything that was recorded (Opus): read_seller_review reads the attribute list and sends each fact with the store's label in the language of the terms, so a lamp's socket reaches the person asked to approve it.
- 2026-09-17: The reception assistant proposes an item type and attributes (Opus, prompt reception-v2): it is given the store's vocabulary and may use only slugs from it; a slug nothing defines is dropped, and everything it returns stays tentative until staff confirm.
- 2026-09-17: A batch is recognised by its prompt, not one version of it (Opus): the reserve allowlist, the attempt gate and the batch credit reserve all key on the reception-batch- prefix. Naming v1 in three places refused every batch once the prompt was versioned.
- 2026-09-17: The seven fixed reception fields are retired (Opus, prompt reception-v3): a review carries an attribute list and nothing else, so the model, the store, the seller and every report describe an item the same way. Old rows keep their metadata; nothing reads it.
- 2026-09-17: The owner appoints Astra (Codex) lead architect and developer, taking over the Fable/Opus work. The accepted roadmap and safety rules remain the baseline; finish the in-flight attribute delivery before expanding scope.

- 2026-09-17: Historical metadata-only reviews remain readable through a read-only attribute adapter; new writes still require the list. Never rewrite accepted evidence. AI response diagnostics record contract fields and error codes only, never values or identifiers.
- 2026-09-17: Reception prompt v4 requires positive two-decimal price text in the provider schema and instructions. A live v3 answer failed price.amount validation after billable inference; engine money validation stays strict and token ceilings remain unchanged.
- 2026-09-18: Quick reception defaults to description and category only (owner). Extra fields come from the selected item type, replacing the seven-field fallback; vocabulary definitions and saved item observations are unchanged.

- 2026-09-18: Agreements are optional by default (owner): agreementRequiredFor=[] in new-store fallbacks. Existing published policies and evidence remain unchanged; owners may opt into requirements or publish a new policy to remove them.
- 2026-09-18: Seller profiles (owner): editable contact, optional address, language and internal notes use immutable revisions with optimistic concurrency. Current contact is a projection; issued statements keep contact snapshots. Quick registration stays minimal; payout details are deferred.
- 2026-09-18: Owner sets the AI-credit offer copy to approximately 4,000 received items in all languages. This is an owner-approved estimate, replacing the usage-derived count in this copy only; balances, metering and budget limits remain unchanged.
- 2026-09-18: Owner simplifies quick reception further: description and price suffice; category is omitted from this form and submission. Item type and its additional fields remain optional.
- 2026-09-18: The app header exposes all eight UI languages with native names and vector flags (UK for English, owner choice). Selection persists in the existing browser-locale cookie and refreshes the current route; account and store language settings remain separate.

- 2026-09-18: AI defaults on for every store with no explicit choice, including legacy published policies. Effective policy reads add the missing flag without rewriting history; explicit false wins. Photo and AI controls lead reception when enabled; quotas and spend caps stay unchanged.

- 2026-09-18: Staff may detach reception photos by appending a source revision, including an empty draft after the last photo. Historical sources, stored files and published reviews stay immutable. Empty drafts cannot be analyzed or published.

- 2026-09-20: Bag inspection may receive one item at a time through the existing quick reception pipeline, with optional photo/AI and immutable bag/session/seller provenance. Existing agreement, acceptance, quota and cost rules still apply; old inspection drafts remain accessible.

- 2026-09-20: Seller directory searches current name, email, phone and postal address within the active tenant. Phone searches ignore separators; wildcard characters remain literal. Existing balance calculations and member access are unchanged.

- 2026-09-20: Manual sales use tenant-scoped search across accepted items and a cart of at most 50 unique items. Search excludes sold and ended items; existing sale validation, exact money and replay-safe recording remain authoritative.
- 2026-09-21: Owner approved private store_guide_versions per tenant: owner/admin saves, member reads, immutable versions, stale-edit protection and actor-bound retries. Store language-independent answers for eight UI languages; answers never activate financial rules.
- 2026-09-22: Signup stores the selected locale as presentation-only Auth metadata. Confirmation subject and body use that locale in all eight languages, with English fallback. Local and protected hosted deployments share one template; verification and authorization stay unchanged.

- 2026-09-22: Store creation asks only for the display name (owner). The form derives an opaque slug from its random request UUID, retaining it on retries. Existing slugs, database uniqueness, membership and authorization are unchanged.

- 2026-09-22: New web stores initialize an immutable policy version atomically with creation: sv=SEK, no=NOK, dk=DKK, en/fi/de/es/it=EUR. Only currency overrides existing defaults. Retries and later language changes never reset it; legacy creation and existing stores stay unchanged.

- 2026-09-23: Owner adopts local-first delivery: batch tested changes before pushing, use previews at review checkpoints and bundle documentation-only work with suitable deliveries. Required CI and merge protections remain; Vercel trigger changes are a separate task.
- 2026-09-23: Owner approved a tenant-bound Shopify privacy queue. Verify signatures before durable receipt; minimize and encrypt data. Bind shops through connection history. Owner/admin records append-only outcomes; receipt never means erasure and no accounting data is auto-deleted.

- 2026-09-24: Store flow snapshots count unstarted drop-offs, unaccepted drafts, reception stages and inventory stages across all rows. Counts reuse queue facts; ages mean time since receipt or registration, not time in a stage. Starting work never implies a whole drop-off is complete.

- 2026-09-24: Seller work is grouped under overview, drop-offs, items, finances, terms, communication and details tabs. Seller item reads filter by tenant and seller before pagination and reuse current lifecycle facts. Existing financial operations and permissions remain unchanged.

- 2026-09-25: Seller ledger, statement and communication reads accept persisted PostgreSQL UUID references without requiring RFC version bits. Historical references remain unchanged; command validation, tenant checks and financial rules are unchanged.

- 2026-09-25: Owner prioritizes mobile-first store workflows with fewer taps and less scrolling. The seller directory uses a compact heading, direct contact links and responsive rows; desktop separates email and phone. All locales share the layout.

- 2026-09-25: Remove repeated store-name labels above dashboard page titles. The shared store selector and breadcrumb identify the active store; document identities and item/drop-off references remain visible.

- 2026-09-25: Text links use persistent underlines across locales. Standalone actions and seller choices have visible control boundaries and touch targets; navigation retains its distinct styling. Inline links and compact tables keep their density.

- 2026-09-25: Staff item browsing paginates tenant-filtered results in accepted-at descending and ID order, retaining text and stage filters. The original items_overview read remains compatible; paging adds no item writes or permissions.
- 2026-09-25: The seller portal shows each unsold item's next frozen markdown step (date, price by the engine's own expression) and whether the store applies steps automatically. Read only through my_items; a scheduled step is a plan, never a promise; no item is called ready to collect.

- 2026-09-25: Seller browsing pages tenant-filtered contact search in name/ID order. Existing seller balance facts and the original overview RPC remain unchanged; search resets paging and stale page links return to the last available page.
- 2026-09-25: Browser item labels use @bwip-js/generic (MIT) for server-rendered Code 128 SVG; @zxing/library (Apache-2.0) verifies decoding in tests only. Label reads reuse tenant-scoped item title, current price and currency; printing sends no facts to an external renderer.
- 2026-09-25: I-label lookup is read-only and limited to the active store. One matching UUID prefix opens the item; multiple matches require an explicit choice and never select the first. Database errors are not reported as missing items.

- 2026-09-25: Seller item search covers only the verified seller account, with literal title/category/reference matching and 25-row pages. It preserves engine price, sale and next-markdown facts; the legacy capped read remains available during rollout.
- 2026-09-25: Seller handover QR codes encode only a same-application H-reference lookup for staff cameras. Codes load on demand under seller identity; opening still requires staff login/MFA, active-store lookup and explicit custody confirmation.

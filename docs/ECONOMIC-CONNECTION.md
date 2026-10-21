# e-conomic: daily exports as drafts

This optional destination supports DKK stores. An owner or administrator connects
one e-conomic agreement, selects an existing journal, publishes a separate account
map and sends frozen day-close exports as drafts. An accountant reviews and books
them in e-conomic. Komisio never calls a booking endpoint.

## Operator setup

Register an e-conomic developer app and configure its installation redirect to
`https://<komisio-host>/api/integrations/economic/callback`. The installation URL
carries a signed state in `redirectUrl`; the provider must preserve it when
returning the grant token. Missing, expired or changed state fails closed.

Set server-only `ECONOMIC_APP_SECRET_TOKEN`, `ECONOMIC_APP_PUBLIC_TOKEN` and
`KOMISIO_CREDENTIAL_KEY` (32 random bytes encoded as 64 hexadecimal characters).
The callback also requires the same signed-in user, active tenant, owner/admin
role, MFA assurance and a matching httpOnly cookie. Never log callback query
strings or token headers at the proxy. The callback immediately redirects to a
token-free settings page with `Referrer-Policy: no-referrer`.

App registration, developer terms, installation limits and production approval
are operator responsibilities. Code deployment does not establish production
approval or Danish accounting suitability. The customer needs a plan with open
API write access (Plus, Smart or Komplet); a 403 points to plan/permission review.
Reading the catalogue cannot prove permission to write drafts.

## Store workflow

1. Open **Accounting → Settings → e-conomic** (also linked from Integrations).
   Connect and check the displayed company and agreement number. The agreement
   must use DKK, matching the store. The agreement number is the binding; the
   company name and CVR are display information.
2. Select **e-conomic** on the Accounts tab. Load the agreement's accounts,
   journals and VAT codes. Select a regular journal accepting finance vouchers.
   Standing journals and accounts that are barred, block direct entries or have
   a default contra account are refused.
3. For each nonzero day-close amount, explicitly map an account, debit/credit
   side and zero-rate VAT code, or record why that amount must not be posted.
   Some totals overlap; the accountant must choose which facts form the voucher.
   Komisio does not silently exclude overlapping totals. Consignment-fee keys
   cannot be excluded. Empty mappings stop export when the amount is nonzero.
4. Every posted line requires an explicit valid VAT code with automatic rate 0%.
   Komisio already froze the VAT amounts. A blank/default code or a nonzero
   automatic rate could cause another VAT calculation and is rejected. Zero
   automatic calculation is not a claim of VAT exemption or correct VAT-return
   reporting; the accountant must check the chosen accounts and codes.
5. On Days, review the lines, exclusions and balance, then prepare the export.
   It records the day-close and map versions. On Exports, inspect the frozen
   lines and choose **Send drafts to e-conomic**. Later map changes never modify
   an existing export. The Reconciliation tab follows the selected destination.

There is no default Danish chart and no scheduled sending in this version.
The SIE/Fortnox map, exports and send lifecycle remain separate.

After loading the catalogue, owners and administrators can request AI account
suggestions from the connected agreement's eligible accounts. Suggestions fill
only untouched rows and include reasons and review questions. They do not select
a journal, VAT codes or exclusions, publish a map or send an export. Existing AI
enablement, credits and quotas apply. Drafts are actor-owned and pin the policy,
map and connection; changes require a fresh draft. Account names are sent to the
configured AI provider as untrusted reference data, without credentials, company
identity, transactions or amounts. Review the suggestions before saving.

## Delivery and uncertain outcomes

Each day close is still a full-day snapshot. A new export freezes only the signed
change from the last confirmed export for that store and date, plus the full target
and the previous export ID. A decrease reverses the posting side. An unchanged
target creates no export. The preview and export show when only a change is sent.

Pending or uncertain sends block every other export for the date, including a new
close or map version. Preparing and sending serialize on the tenant lock; a
prepared export whose baseline has advanced must be prepared again as a new row.
The old row stays readable. Account/VAT mappings, agreement and journal must match
the previous confirmed export; changing that context requires reconciliation.

One confirmed legacy full export can provide the initial baseline. Multiple
legacy full exports for a date require manual reconciliation, not an inferred
reversal. Existing split or unverified sends remain held. A newly deployed parser
or clearer message neither confirms them nor sends them again.

One export has at most one live send claim. Concurrent requests and request-ID
replays cannot dispatch another POST. One REST journal-voucher request contains
all Finance Voucher entries, the day-close date, DKK and exact decimal formatting
of integer øre. Komisio reads the provider's accounting years and requires exactly
one open year covering the date; it does not assume a calendar year. The provider
allocates the voucher number for the complete voucher.
Its text includes `Dagsafslutning <date> v<version>` and `K-<send-id>`.
The Idempotency-Key header is supplementary; no provider retry/cache guarantee
is assumed. The durable engine claim is the duplicate-safety boundary.

After the POST, Komisio reads the whole voucher using its returned number and the
pinned journal/year. It checks every date, account, VAT code, currency, amount,
description and absence of a contra entry or additional automatic VAT. Missing,
extra or foreign entries are rejected. All lines must match the export and share
**one voucher number** before the send is marked sent. The former Journals bulk
endpoint allocated separate voucher numbers per line; existing split exports
remain held and are never automatically resent or renumbered.

A proven failure before POST can be retried after correcting the cause. A
provider `Retry-After` delay is stored and enforced. An interrupted request,
malformed response, 401/403/429/5xx after POST, missing entries or unverifiable
grouping stays held. A lost database acknowledgement also retains the pending
claim. There is no blind replay or automatic expiration.

Only the owner may confirm a held send. Locate `K-<send-id>` in the pinned
agreement and journal, compare **every** line and amount, and supply the journal,
single voucher number and review evidence. Confirmation appends an immutable
event. It does not resend, edit provider entries or prove an absent voucher.
If the lines span multiple vouchers or are incomplete, leave the send held and
resolve it with the accountant/support; do not invent a confirmation.

## Disconnecting, key rotation and verification

Disconnect deletes the locally sealed grant and appends an event. Also remove
the app access in e-conomic. There is no assumed API revocation endpoint.
Reconnecting while connected must return the same agreement; disconnect is the
explicit step before connecting another agreement. Historical exports remain
bound to their original agreement and cannot be sent through another one.

Grants are encrypted with tenant-specific authenticated data. Rotating the
credential key makes existing grants unreadable; disconnect/reconnect through
the authorized workflow. Status and audit events contain no token/ciphertext.
Staff can review accounting facts but cannot connect, map or send; administrators
cannot manually confirm held sends. Database membership and MFA checks apply
independently of the UI.

Automated tests use synthetic accounts and a loopback simulator. After the
standard build, run `npx playwright test --config=economic.playwright.config.ts`
against local Supabase. The dedicated test-process preload accepts only
synthetic credentials and loopback app/database addresses. It is not imported
by production code and production provider origins cannot be configured.
Before enabling a real store, verify the installation callback, package/write
permissions, exact draft grouping, journal totals and VAT-return treatment with
the provider/accountant. Never use real agreements in automated tests.

Official API references and check date: [adapter README](../extensions/economic/README.md).

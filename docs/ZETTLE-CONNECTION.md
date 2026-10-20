# PayPal POS connection

## Automated coverage

The synthetic currency matrix covers SEK, NOK, DKK, EUR and USD:

| Layer | Verified behavior |
|---|---|
| Unit (`zettle`, `zettle-http`, `pos-catalog`) | Exact minor-unit export/read/import prices; matching sales and refunds; every other supported currency held; non-ASCII titles; conditional image association/replay |
| pgTAP (`0360_zettle_currency_matrix`) | Current currency validators/constraints; exports; foreign receipts create no sale, credit or pending operation; one sale/refund on replay; credit reversal |
| Browser (`zettle`, `zettle-matrix`) | Five-currency checkout/credit/refund journeys, NOK export with 25.5% mapping, EUR receipt held without financial writes, eight-language workspace at 320px |

VAT coverage includes 0, 13.5, 19, 21, 22, 24, 25 and 25.5 percent through
publication, export, decimal-string readback and comparison. A 25/25.5 mismatch
stays a mismatch; none of these tests establishes legal tax treatment.

For this coverage-only slice, the existing workspace display contract is retained:
percentages use two fixed decimals and `%`; receipt amounts use two fixed decimals
and the ISO currency code in every language. Labels and comparison explanations
come from the selected dictionary. Receipt detail still exposes a technical
reason such as `currency` alongside localized held guidance. This is a baseline,
not a claim that all receipt diagnostics are translated. Translation of these
reason codes and obsolete generic refund guidance is tracked in
[#529](https://github.com/Komisio/komisio/issues/529).

SQL and the installed Zod schema accept 120-code-point product titles including
emoji. Receipt description truncation can still split an emoji at its UTF-16
boundary; [#528](https://github.com/Komisio/komisio/issues/528) tracks the expected
failure regression separately. Fixtures are synthetic documented wire shapes,
not recordings or proof of real-till behavior. The live checklist is in
[ZETTLE-LIVE-PULL.md](ZETTLE-LIVE-PULL.md).

## Item status and recovery

The items table has a shared **Synchronization** column. Each connected system
has its own status; PayPal POS and Shopify can show different results for the
same item. Advanced search filters by system and status together before
pagination. Each status opens the item's shared panel, with separate recorded
product, stock and image outcomes and their available timestamps. These are
saved observations, not continuous reads of the remote inventory. A Shopify
product acknowledgement does not invent a separate inventory observation.

For PayPal POS, only a current acknowledged product snapshot with confirmed initial stock is
shown as synced. A changed price, catalog mapping or bound store policy needs
another export. Sold or ended items are not offered for export. Image outcome
remains separate; it does not imply the current default photo was transferred.

Owners/admins can choose **Sync now** from the item panel after activating the
connection. It uses the existing export engine and stock safeguards. Retrying a
reported export failure retains the request identity and does not reload the
page. Uncertain stock or provider conflicts still require reconciliation, and
retries never grant another unit. Staff/read-only members see status without an
export action. No automatic product export is enabled by this read-only slice.

## Partner-hosted connection

Owners/admins choose **Connect PayPal POS**, sign in with PayPal and approve
Komisio. Stores never create developer credentials. The shared partner-hosted app uses
[authorization code grant](https://developer.zettle.com/docs/api/oauth/api-reference)
with the app client ID and server-only client secret. The SDK-app PKCE flow is
not the partner-hosted credential contract. Requested scopes are READ:USERINFO,
READ:PRODUCT, WRITE:PRODUCT and READ:PURCHASE. No payment or refund execution
is requested.

The callback binds the authenticated staff identity, active tenant, expiring
signed state, encrypted HttpOnly cookie and current connection revision. The
exact redirect URI used at authorization is bound into that cookie and reused
for the token exchange.
The server verifies the merchant through users/self before sealing the access
and refresh tokens with tenant-bound AES-256-GCM. A reconnection must match the
existing merchant, including the immutable synchronization connection pin.
Connecting does not enable catalog export, receipt import or automation grants.

The old API-key form, assertion grant and deployment credential fallback are
retired. Migration `20261012180000` extends the existing operational credentials
table and revokes the old write function. Financial and synchronization history
is retained. A local disconnect erases usable encrypted tokens and stops future
credential acquisition. It does not recall requests already sent to PayPal or
revoke the app in PayPal; merchants can also remove that authorization there.

## Host configuration

1. Register a public API app in the PayPal POS developer portal.
2. Configure server-only `PAYPAL_POS_CLIENT_ID`, `PAYPAL_POS_CLIENT_SECRET`
   and `KOMISIO_CREDENTIAL_KEY`. Use the matching app credentials from the portal.
   Configure both staging and production hosts and redeploy after changes.
   The secret is required for both code exchange and token renewal.
3. Register each exact callback URL in the app's OAuth Redirect URIs:
   - Staging: `https://komisio-staging.vercel.app/api/integrations/paypal/callback`
   - Production: `https://app.komisio.com/api/integrations/paypal/callback`
   - Self-hosted: `<NEXT_PUBLIC_APP_URL>/api/integrations/paypal/callback`.
4. Apply the migration before deploying. The canonical NEXT_PUBLIC_APP_URL
   must match the app registration. Use HTTPS outside loopback development.
5. Connect a test merchant, verify its identity, and separately activate the
   required synchronization settings. Registration alone is not a live OAuth test.

Do not put real credentials in source control, logs or test fixtures. Keep the
credential encryption key stable: changing it makes stored tokens unreadable.
Existing obsolete ZETTLE_CLIENT_ID/API_KEY/PILOT_TENANT_ID/MERCHANT_ID deployment
variables are ignored and can be removed.

## Token renewal and recovery

Only owner/admin sessions or the existing accepted, scoped automation actor
can read/renew tokens. A durable database claim is acquired before sending a
rotating refresh token. Concurrent requests wait until their next invocation;
they never send the same refresh token a second time. Saving the replacement
requires the same claim and connection revision. Reconnection or disconnect
invalidates in-flight saves. Tokens and raw provider errors never reach the GUI.

If a refresh request or save has an unknown outcome, do not replay it. After
one minute the connection page asks for reconnection. The store reconnects to
the same merchant. Catalog outcomes and sales keep their existing retry rules.
The integrations page reads status without decrypting or refreshing credentials.

## Verification

Unit tests cover partner client authentication, exact redirect reuse,
tenant/user/cookie binding, expiry, stale callbacks,
merchant verification, encrypted token storage and renewal failures. pgTAP
covers role/MFA and worker authorization; a multi-connection test proves one
refresh claimant. Browser tests cover setup and callback rejection without
calling a real merchant. A successful hosted consent/callback and real token
renewal still need verification with the registered app after host configuration.

## Receipt retrieval after verification

The verified merchant pin now enables a separate explicit activation and bounded
manual receipt retrieval. See [ZETTLE-LIVE-PULL.md](ZETTLE-LIVE-PULL.md). The identity
check itself still changes no products or sales.

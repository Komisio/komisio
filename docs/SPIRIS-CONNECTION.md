# Spiris connection

Spiris (formerly Visma eEkonomi, Visma eAccounting outside Sweden; the API is still the Visma eAccounting API) is the second accounting target next to
Fortnox and follows the same contract: one connected company per store, tokens
sealed on the server, every step an append-only event, one recorded export
becomes at most one voucher.

## Store-owned accounts

Each tenant connects its own Spiris company from /intake/integrations. The host
configures `SPIRIS_CLIENT_ID`, `SPIRIS_CLIENT_SECRET` and
`KOMISIO_CREDENTIAL_KEY`, and registers the `/api/integrations/spiris/callback`
URL with Spiris. The authorisation asks for `ea:api ea:accounting
offline_access`. `SPIRIS_IDENTITY_URL` and `SPIRIS_API_URL` default to
`https://identity.vismaonline.com` and
`https://eaccountingapi.vismaonline.com/v2`; set them to Visma's sandbox hosts
to connect a test company.

Owner/admin types the company name before OAuth; signed state binds it to the
tenant. The callback reads `GET /companysettings`, refuses any company whose
name differs from the typed one (recording the refusal without the token), and
stores the sealed tokens through `store_spiris_connection`. Spiris reports no
company database id, so the connection is bound to a company key: the
corporate identity number, or the normalised name when the company has none.
A reconnect for another key is refused. The company currency is stored with
the connection.

## Renewal

Access tokens last an hour and every renewal issues a new refresh token.
`refresh_spiris_tokens` is revision-bound exactly like the Fortnox renewal: a
stale revision returns `{ "error": "SPIRIS_CONNECTION_CHANGED" }` as data, the
application rereads once and otherwise stops. No tokens appear in results or
events.

## Vouchers

`begin_spiris_send` opens one pending send per export, bound to the connected
company key, and refuses when the store currency differs from the company
currency (`SPIRIS_CURRENCY_MISMATCH`). The application verifies that the
company answering for the token is still the bound one, then `POST /vouchers`
carries exactly the recorded lines (voucher date, tenant account numbers,
amounts with two decimals). Spiris chooses the number series and answers with
the voucher id and its number in the series ("A12"); `complete_spiris_send`
records them. A sent row is immutable and never resent; a proven preflight
failure may be retried as a new row; an uncertain outcome holds the export
until the owner confirms the voucher in Spiris through `reconcile_spiris_send`
with evidence. Absence cannot be confirmed.

Not in this slice: automatic sending, the reconciliation view and the help
panel, which still cover Fortnox only.

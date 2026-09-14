# Fortnox connection

Version 1 connects one Fortnox company to one store, verifies it and keeps
the tokens sealed on the server. It sends nothing to Fortnox. Voucher sending
is a later slice and requires the database pin described below.

## Why the company is pinned

The Fortnox integration (client id and secret) belongs to the developer
account. Which company a token belongs to is decided by the person who
authorises in the Fortnox consent screen, not by the integration. The pilot
developer account also owns a production company, so a token for the wrong
company must be refused before it is stored, and the check must not rely on
the organisation number: a Fortnox test company can carry the same number as
the production company it was created from.

Two pins apply, read from the deployed configuration:

| Pin                                | When                         | Source                                |
| ---------------------------------- | ---------------------------- | ------------------------------------- |
| `FORTNOX_EXPECTED_COMPANY_NAME`    | mandatory from the first day | the company name shown in Fortnox     |
| `FORTNOX_EXPECTED_DATABASE_NUMBER` | after the first check        | `DatabaseNumber` from the first check |

A token whose company information does not match both pins (the second when
set) is dropped; only the company name, database number and the reason are
recorded as a `refused` event. The database number pin in configuration is
optional (owner decision 2026-09-14: the Fortnox consent screen makes the
company choice explicit); the stored connection is itself bound to the
database number it was made with, and every check, refresh and send is
refused when another database answers.

## Configuration

Server-only, in Vercel (Production) for the hosted pilot:

| Variable                           | Meaning                                                |
| ---------------------------------- | ------------------------------------------------------ |
| `FORTNOX_CLIENT_ID`                | integration client id from the developer portal        |
| `FORTNOX_CLIENT_SECRET`            | integration client secret                              |
| `FORTNOX_PILOT_TENANT_ID`          | the one store allowed to connect (uuid)                |
| `FORTNOX_EXPECTED_COMPANY_NAME`    | the company name pin, compared case-insensitively      |
| `FORTNOX_EXPECTED_DATABASE_NUMBER` | the database number pin, optional until first check    |
| `KOMISIO_CREDENTIAL_KEY`           | 64 hex characters; seals stored tokens and signs state |

The developer portal must list the redirect URI
`<NEXT_PUBLIC_APP_URL>/api/integrations/fortnox/callback` and the scopes
`companyinformation` and `bookkeeping`. Rotating `KOMISIO_CREDENTIAL_KEY`
makes stored tokens unreadable (`CREDENTIAL_UNREADABLE`); the owner
disconnects and connects again.

## Flow

1. Owner or admin presses "Connect Fortnox" on the accounting page. The
   server signs a state (tenant id, ten minutes) with the credential key,
   stores it in an httpOnly cookie scoped to the Fortnox routes and redirects
   to the Fortnox consent screen with `access_type=offline`.
2. Fortnox returns to the callback with a code. The state must verify and
   match the cookie; the signed-in user must still be owner or admin of the
   tenant named in the state.
3. The code is exchanged for tokens; `companyinformation` is read with the
   access token; the pins are checked. On mismatch the token is dropped and a
   refusal recorded. On match the tokens are sealed (AES-256-GCM, purpose
   bound) and stored through `store_fortnox_connection`.
4. "Check Fortnox connection" re-reads the company with the stored token
   (refreshing and re-sealing when close to expiry; Fortnox rotates refresh
   tokens) and records a `checked` event with the company identity.
5. "Disconnect" deletes the row through `disconnect_fortnox` and records the
   event.

## Database

- `fortnox_connections`: one row per tenant with database number, company
  name, organisation number (for display only), the sealed box (`iv`, `tag`,
  `data`), scope, expiry and timestamps. No grant to any role; update and
  delete are refused outside the engine (`IMMUTABLE_CONNECTION`). While a
  row exists a token for another database number is refused
  (`FORTNOX_WRONG_COMPANY`).
- `fortnox_connection_events`: append-only (`connected`, `refreshed`,
  `checked`, `refused`, `disconnected`), readable by owner or admin.
- Functions: `store_fortnox_connection`, `read_fortnox_connection` (owner or
  admin; the only path to the ciphertext), `fortnox_connection_status` (any
  member; never the ciphertext), `record_fortnox_check`, `disconnect_fortnox`.

## Voucher sending

One recorded export (see [ACCOUNTING-EXPORT.md](ACCOUNTING-EXPORT.md)) becomes
at most one voucher in the connected company. Owner or admin presses "Send to
Fortnox" on an export row; the request carries a request id.

1. `begin_fortnox_send` opens a send row bound to the connection's database
   number. It refuses without a connection, for a store whose currency is not
   SEK (`FORTNOX_CURRENCY_UNSUPPORTED`; Fortnox vouchers are in the company
   currency), for an export already sent (`FORTNOX_ALREADY_SENT`) and while
   another send is pending (`FORTNOX_SEND_IN_PROGRESS`, ten minutes, after
   which the stale row is closed as failed). Replay by request id returns the
   recorded state.
2. The server reads the company with the stored token and refuses when the
   database number differs from the one the send is bound to.
3. `POST /3/vouchers` with series A, the close date as transaction date,
   description `Dagsavslut <date> v<version>` and the recorded lines: the
   tenant's four-digit accounts, amounts as kronor with two decimals. Komisio
   invents no accounts and no postings; the lines are exactly the export.
4. `complete_fortnox_send` closes the row as `sent` (series, number, year) or
   `failed` (reason code and Fortnox's message). Sent rows are immutable; a
   failed export may be sent again as a new row. Members see the send log;
   sending is owner or admin.

## Not in this slice

Account mapping changes, reading or correcting Fortnox vouchers, automatic
sending at a set time, stores in other currencies, more than one store per
deployment (the single pilot slot mirrors the Zettle pilot), a per-tenant
client id.

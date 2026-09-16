# Hosted MCP connector

Design and delivery note by Fable, 2026-09-16, on the owner's direction that a
store should be able to connect its own AI assistant to Komisio the way it
connects one to an accounting system: add a connector, sign in, approve, done.
Nothing is installed at the store, and Komisio pays no model tokens: the
assistant is the store's own (Claude, ChatGPT or another MCP client), and it
calls Komisio's tools over HTTPS.

Delivered in migration `20260916430000` with the endpoints below. It builds on
the local MCP adapter in [mcp/README.md](../mcp/README.md): the same tool
catalogue and the same engine functions, minus the tools whose reads are not
yet SQL functions (listed at the end).

## What a store does

1. In the assistant, add a custom connector with the address
   `https://<app>/api/mcp`.
2. The assistant discovers Komisio's OAuth metadata, registers itself and
   sends the person to `https://<app>/oauth/authorize`.
3. The person signs in (with MFA where the account has it), picks the store
   and unticks any scope the assistant should not have, and approves.
4. The assistant receives a code, exchanges it for tokens and starts calling
   tools. The connection is listed under Settings, "AI assistants", and can
   be disconnected there at any time.

The connector is free, like everything else in Komisio ([PRICING.md](PRICING.md)); the
store's own assistant pays its own model tokens.
The setting `KOMISIO_CONNECTORS_ENABLED=true` turns the endpoints on; they
answer 404 otherwise. `NEXT_PUBLIC_APP_URL` is the issuer.

## Endpoints

| Path                                                  | Role                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-authorization-server`         | RFC 8414 metadata: Komisio is the authorization server                                                                    |
| `GET /.well-known/oauth-protected-resource[/api/mcp]` | RFC 9728 metadata for the MCP endpoint                                                                                    |
| `POST /api/oauth/register`                            | RFC 7591 dynamic registration of a public client (name, redirect URIs; no secret)                                         |
| `GET /oauth/authorize`                                | The consent page (signed-in members only; an invalid request is shown, never redirected)                                  |
| `POST /api/oauth/authorize`                           | The consent decision; returns the redirect with the one-time code                                                         |
| `POST /api/oauth/token`                               | Authorization code with PKCE (S256 only) and refresh token grants; public clients, `token_endpoint_auth_method: none`     |
| `POST /api/mcp`                                       | The MCP endpoint (Streamable HTTP, stateless, JSON responses); a missing or bad token answers 401 with `WWW-Authenticate` |
| `POST /api/connectors`                                | Disconnect a grant from Settings                                                                                          |

## How a tool call runs

A hosted access token is an opaque 256-bit secret. The database holds its
SHA-256 hash with the grant it belongs to: one store, the person who approved,
the client, the scopes, the assurance level of the approving session, and an
expiry (one hour; refresh tokens thirty days, rotated on every use).

The MCP endpoint looks the token up (`connector_token_info`), builds the same
`createReceptionMCP` server the local adapter uses, and hands it a client whose
every `rpc` becomes one call of `public.connector_call(token_hash, function,
arguments)`. That function, in one transaction:

1. finds the grant and refuses an expired token or a revoked grant;
2. requires the function to be listed in `connector_functions` under one of
   the grant's scopes (`propose_operation` is listed per operation kind);
3. requires `p_tenant` to be the granted store;
4. sets the request claims to the approving person (`sub`, `role`, the
   recorded `aal`, and `amr: connector`) for the rest of the transaction and
   checks that the person is still a member with a store role;
5. calls the engine function with the arguments cast to its declared
   parameter types, and records the call in `connector_calls`.

The engine function therefore sees exactly what the person's own session
would see: `auth.uid()`, `tenant_role`, `verified_session` and the plan gate
all behave as for that person. A proposal made through a connector carries
the person as proposer, so the four-eyes rule (a different person approves)
holds. Nothing in the engine was changed for the connector; no service key
and no Supabase JWT are involved.

This is an impersonation mechanism, bounded by: the token the person created
on the consent page, the scope allowlist in SQL, the store binding, the live
membership check and the audit rows (`connector.authorized` and
`connector.revoked` in the access log, every call in `connector_calls`).
Recorded as a decision in DECISIONS.md.

## Replay and leaks

- A code is one-time and lives ten minutes. A replayed code, or a reused
  refresh token, means the secret leaked: the token endpoint voids the whole
  grant (`void_connector_secret`) and the assistant has to be approved again.
- Tokens are never logged, never stored in clear and never shown after the
  token response. Holding a secret's hash is holding the secret, so voiding
  a grant by hash needs no session.
- Registration is open (any client may register) but capped at 200 new
  clients an hour and to https redirect URIs (http only on localhost).

## Scopes and tools

The scopes are those of the local adapter except `reception:photos` (photo
bytes come from storage, which a connector cannot read). Tools whose engine
reads use table access instead of SQL functions are not registered for hosted
grants; they stay available in the local adapter until their reads move to
SQL:

`komisio_read_inspection_operation`, `komisio_read_reception_operation`,
`komisio_preview_inspection`, `komisio_prepare_inspection_reception`,
`komisio_list_bags`, `komisio_read_inspection`,
`komisio_read_reception_history`, `komisio_list_receptions`,
`komisio_read_reception`, `komisio_preview_reception`,
`komisio_propose_reception_review`, `komisio_read_reception_photo`,
`komisio_read_item_summary`, `komisio_find_receipts`, `komisio_read_receipt`,
`komisio_read_seller_ledger`, `komisio_list_day_closes`,
`komisio_propose_price_change`.

Everything else is served: store policy and profile, item search, economy
summary, brief and stock report, seller balance, price evidence and photo
duplicates, operation listing, accounting preview and reconciliation,
settlement candidates, and every proposal tool.

## Verification

- pgTAP `0111_connectors` (34 assertions): registration, consent, PKCE,
  one-time code, replay voiding, scope and store binding, unknown arguments,
  refresh rotation, listing and revocation by role, and that
  every allowed function exists with a `p_tenant` parameter.
- `scripts/test-connector-mcp.ts`, run by `npm run test:mcp` in CI: the whole
  walk against the local database with the real MCP server in process, then
  a proposal whose `proposed_by` is the approving person, a refresh and a
  revocation that stops the assistant at once.
- Unit tests in `tests/unit/connectors.test.ts`.

Not yet verified: a real assistant (Claude, ChatGPT) against staging. That
needs `KOMISIO_CONNECTORS_ENABLED=true` on the staging deployment (owner
action A15); the owner runs the first connection.

## Later

- Move the excluded reads to SQL functions and register the remaining tools.
- A hosted copilot with a token quota inside the application, on the same
  connector grants (roadmap P4).
- `connector` as a visible "via" on proposals in the operations queue (the
  audit rows exist; the queue does not show them yet).

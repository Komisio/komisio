# Local reception MCP

This is a real stdio Model Context Protocol adapter using the official TypeScript
SDK. It is separate from the web app and optional model-provider integration.
It exposes narrow tools through the same reception engine:

| Tool                         | Scope             | Effect                                                                                   |
| ---------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| komisio_read_reception       | reception:read    | Read one saved session and its source snapshot                                           |
| komisio_preview_reception    | reception:preview | Validate a source-bound proposal against the current revision; return an unsaved preview |
| komisio_read_reception_photo | reception:photos  | Read one attached photo at the exact current revision as native MCP image content        |

Every data call verifies the configured user token with Supabase Auth and checks
current store membership and required MFA in the database. The store is pinned in
the process configuration, not supplied by the model. Unknown tool arguments are
rejected. Sources are untrusted evidence. The server cannot list sellers, create
sessions, upload photos, spend model tokens, publish reviews, issue links, approve
for a seller or perform financial operations.

## Configuration

Use Node >=22.12 and `npm ci`. The trusted local MCP host supplies these dedicated
environment variables to the child process:

- `KOMISIO_MCP_SUPABASE_URL`: your Supabase project HTTPS URL (HTTP only for loopback)
- `KOMISIO_MCP_PUBLISHABLE_KEY`: the project's publishable/anon key
- `KOMISIO_MCP_ACCESS_TOKEN`: a current authenticated **user access token**, never
  a service-role key, password or refresh token
- `KOMISIO_MCP_TENANT_ID`: exactly one store UUID
- `KOMISIO_MCP_SCOPES`: an explicit comma-separated subset of `reception:read`,
  `reception:preview`, `reception:photos`. Photo access is opt-in, not implied by read.

Have the host launch `node --import tsx mcp/stdio.ts` with the repository as its
working directory. Use the direct command, not a shell that prints banners to
stdout. `npm run mcp` is convenient for manual startup but a host should launch
Node directly. Do not paste real tokens into prompts, commit them or copy browser
cookies. A friendly delegated login/refresh flow is not implemented yet.

The access token expires normally; there is no refresh-token storage or login
bypass. Use a least-privileged dedicated test user. These scopes restrict tools
in this local process; **they do not narrow the underlying user's Supabase JWT**.
The trusted host can see environment credentials, so this is not a delegated-key
sandbox. No token is accepted as a tool argument or passed through a remote MCP
endpoint. Do not expose the stdio process over an unauthenticated network bridge.

Tool responses go to the MCP host and may be sent to its chosen model. Evidence
notes can contain private text; there is no automatic redaction. With the photo
scope, the host also receives reduced garment images. Seller contact lookup is
not exposed. Komisio does not pay for or select the external
host's model. Built-in reception inference has separate configuration and limits.

## Opt-in vision input

`komisio_read_reception_photo` accepts only session ID, attached photo ID and
exact current revision. It reads the private original with the authenticated
engine, decodes/minimizes it through `lib/media/`, then rechecks membership/MFA
and revision before returning. No remote image URL or Storage path is accepted.
The result contains one native MCP `image` block (JPEG, at most 1536 pixels per
edge and 1 MiB), plus actor, source ID and source revision in structured content.
Hosts must support a response buffer of at least 2 MiB for base64 image content.

Embedded metadata is removed. Visible people, labels and instructions in the
pixels remain untrusted; minimization is not redaction or authenticity checking.
The host may send the image to its own model. Nothing is persisted, published or
sent to Komisio's configured provider by this tool. A subsequent proposal preview
must still cite the exact source IDs and independently pass current-revision
checks. Price still requires price evidence; a photo does not create market data.

## Preview is not a staged write

Preview output explicitly includes `persisted:false`, `staged:false`,
`requiresStaffReview:true`, the verified actor and exact source revision. Facts
are tentative even if the caller claimed they were observed. Nothing is saved or
available for sale. There is no automatic GUI import of an external preview yet.

Future durable agent writes need a separately reviewed pending-operation contract,
actor attribution, approval surface, expiry/replay behavior and executor tests.
Future hosted MCP needs audience-bound OAuth, discovery and scoped delegation;
ordinary Supabase user tokens must not become pass-through HTTP MCP credentials.

## Accounted reference and validation

The reviewed [Accounted MCP contract](https://github.com/erp-mafia/accounted/blob/91ab339a863239650f77eae8ab9d415574a90632/extensions/general/mcp-server/README.md)
informs strict schemas, explicit scope mapping, stable tool definitions and clear
staged-operation envelopes. Accounted has a substantially larger hosted MCP,
OAuth and pending-operation implementation. Komisio's local preview is a smaller
first slice, not feature parity. No Accounted source code was copied.

`npm run test:mcp` creates synthetic data in local Supabase and connects through
real stdio with the official client. It tests protocol negotiation, strict catalog,
source revision, scope filtering, invalid token, unknown store and enrolled-MFA
denial, and verifies that no source/review/model-attempt write was made by tools.
The web build remains independent; Vercel does not host this stdio process.

Official references checked 2026-09-12:
[SDK stdio server](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server),
[MCP authorization and stdio environment credentials](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

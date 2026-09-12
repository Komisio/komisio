# Local intake MCP

This is a real stdio Model Context Protocol adapter using the official TypeScript
SDK. It is separate from the web app and optional model-provider integration.
It exposes narrow tools through the same intake engine:

| Tool                             | Scope              | Effect                                                                                         |
| -------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| komisio_preview_inspection       | inspection:preview | Return unsaved descriptive before/after at the exact saved base revision; no approval or write |
| komisio_list_bags                | inspection:read    | Find a printed bag number or page through bag IDs; no seller data or notes                     |
| komisio_read_inspection          | inspection:read    | Read bounded saved bag drafts and exact history; no notes, contacts or writes                  |
| komisio_read_reception_operation | reception:read     | Read exact staged proposal sources and agreement terms; no decision                            |
| komisio_list_receptions          | reception:read     | Read a bounded queue with shared next-step guidance, not commercial acceptance                 |
| komisio_read_reception_history   | reception:read     | Read bounded version summaries, with separate source/review cursors; no images or links        |
| komisio_read_reception           | reception:read     | Read one saved session and its source snapshot                                                 |
| komisio_preview_reception        | reception:preview  | Validate a source-bound proposal against the current revision; return an unsaved preview       |
| komisio_read_reception_photo     | reception:photos   | Read one attached photo at the exact current revision as native MCP image content              |
| komisio_propose_reception_review | reception:propose  | Stage a complete review for staff approval; publishes nothing (see docs/STAGED-OPERATIONS.md)  |

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
  `reception:preview`, `reception:photos`, `reception:propose`, `inspection:read`, `inspection:preview`.
  Bag inspection, photo access and staging are separately opt-in.

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

History accepts `sessionId` and optional exclusive integer `beforeSource` and
`beforeReview` cursors. Each list returns at most20 records and its next cursor.
These are separate reads, not a single current-state snapshot. Historical
approvals are tied to their proposal version, never carried to new evidence.
See [history contract](../docs/RECEPTION-HISTORY.md) for summary limitations.

Preview output explicitly includes `persisted:false`, `staged:false`,
`requiresStaffReview:true`, the verified actor and exact source revision. Facts
are tentative even if the caller claimed they were observed. Nothing is saved or
available for sale. There is no automatic GUI import of an external preview yet.

## Proposals are staged, not executed

With the separate `reception:propose` scope, `komisio_propose_reception_review`
stages a complete, source-cited review as a pending operation. The response says
`staged:true` and `executed:false`. A staff member approves or rejects it at
`/intake/operations`; approval publishes the review as that person. The host
cannot approve, cannot raise the risk level and cannot skip the preflight checks.
See [staged operations](../docs/STAGED-OPERATIONS.md) for the contract.

Future hosted MCP needs audience-bound OAuth, discovery and scoped delegation;
ordinary Supabase user tokens must not become pass-through HTTP MCP credentials.

## Tool contract and validation

The tool contract is deliberately strict: closed input schemas, an explicit scope
map, stable tool definitions and a clear envelope that states what was and was
not persisted. Komisio's local preview is a first slice; hosted MCP, OAuth and
pending operations follow separately.

`npm run test:mcp` creates synthetic data in local Supabase and connects through
real stdio with the official client. It tests protocol negotiation, strict catalog,
source revision, scope filtering, invalid token, unknown store and enrolled-MFA
denial, and verifies that no source/review/model-attempt write was made by tools.
The web build remains independent; Vercel does not host this stdio process.

Official references checked 2026-09-12:
[SDK stdio server](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server),
[MCP authorization and stdio environment credentials](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

The read scope also provides `komisio_list_receptions`: a bounded, stage-filtered
queue using the same engine as the operator UI. Optional `stage`, `before` and
`beforeId` arguments cannot select another tenant. Results include seller display
names (untrusted data), version references, response and link state, but no contact
details, capability links or images. A seller-approved review is not a sellable
item. Cursor paging is read-time, not a snapshot across subsequent calls.

## Saved bag inspection

`komisio_read_inspection` accepts a bag ID, optional selected draft/version,
archive status and list/history cursors. Each list is bounded to20 rows. The
response includes explicit continuation IDs, current selected draft and an exact
historical version when requested. Historical data does not authorize a write;
engine commands recheck revisions. No source or certainty is invented from draft
text. Bag notes and contact lookup are excluded; descriptions and change reasons
remain untrusted staff-entered text. See [shared inspection read](../docs/INSPECTION-READ.md).

Use `komisio_list_bags` with `{ "bag": "K-123" }` to find the bag's ID, then pass
that ID to `komisio_read_inspection`. An empty argument object lists the newest20
receipts. Pass the returned `older` or `newer` string to page in one direction.
Exact number lookup and paging reuse the staff bag queue engine. Results contain
only bag ID, printed reference and received time; no seller names, contacts or
bag notes. The tool does not record a new receipt or confirm an individual item.

## Unsaved inspection changes

With explicit `inspection:preview`, call `komisio_preview_inspection` with bag ID,
draft ID, expected saved revision and proposed description/category/condition
fields. The shared engine rejects stale or archived drafts and returns exact
before/after values and a change list. It saves nothing and grants no approval.
Unchanged suggestions produce an empty change list. Clearing category/condition
is explicit; description cannot become empty. The result uses the actual saved
base revision, not a fabricated persisted next version. See
[inspection preview](../docs/INSPECTION-PREVIEW.md). No model is called by this tool.

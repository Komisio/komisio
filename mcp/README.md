# Local intake MCP

This is a real stdio Model Context Protocol adapter using the official TypeScript
SDK. It is separate from the web app and optional model-provider integration.
It exposes narrow tools through the same intake engine:

| Tool                                   | Scope                  | Effect                                                                                                         |
| -------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| komisio_list_inspection_operations     | inspection:read        | Page through inspection operation status summaries; no payload, people or decisions                            |
| komisio_list_reception_operations      | reception:read         | Page through reception operation status summaries; no inspection access                                        |
| komisio_find_items                     | items:read             | Accepted items by text in title or category and by lifecycle stage, with current price in öre; no names        |
| komisio_read_item_summary              | items:read             | One item: origin, frozen terms, price series and event kinds; free-text reasons and details omitted            |
| komisio_find_receipts                  | sales:read             | Recorded sales, newest first, by provider, exact external id or status; totals in öre, no lines, no names      |
| komisio_read_receipt                   | sales:read             | One sale with its frozen lines: price, commission, seller credit and VAT per line in öre; seller ids only      |
| komisio_propose_inspection_edit        | inspection:propose     | Stage a complete descriptive edit against an exact saved revision; staff approval required                     |
| komisio_read_seller_balance            | economy:read           | Engine-computed balance for one seller, in ore; no writes                                                      |
| komisio_read_seller_ledger             | economy:read           | At most 50 recent events, without private reasons or contacts                                                  |
| komisio_read_economy_summary           | economy:read           | Store totals for a period of at most one year, per VAT mode and day, liability and open payouts; no writes     |
| komisio_read_economy_brief             | economy:read           | Weekly or monthly brief: fixed sentences over the summary for one period and the one before; no writes         |
| komisio_read_stock_report              | economy:read           | Margin, sell-through and stock age per category for a period; amounts in öre; no names, no writes              |
| komisio_propose_acceptance             | items:propose          | Stage commercial acceptance of one origin at an öre price; a different person than the proposer approves       |
| komisio_propose_return                 | sales:propose          | Stage a full refund of one completed sale line with a reason; a different person approves                      |
| komisio_propose_ledger_adjustment      | ledger:propose         | Stage a signed seller ledger adjustment with a reason; executes only for an owner or admin approver            |
| komisio_propose_markdown_batch         | lifecycle:propose      | Stage up to 50 due markdown steps as one low-risk batch; refused whole if any step is not due                  |
| komisio_propose_bulk_item_update       | lifecycle:propose      | Stage one price change or end of period for up to 50 items with a preview; a different person approves         |
| komisio_propose_price_change           | lifecycle:propose      | Stage a new price for one item citing price evidence; a stale citation is refused; a different person approves |
| komisio_propose_message                | communications:propose | Stage the free-text block of the fixed seller message template; sent by the store once approved                |
| komisio_propose_payout_approval        | payouts:propose        | Stage approving one requested payout; a different person approves and the amount is reserved then              |
| komisio_propose_payout_payment         | payouts:propose        | Stage marking one approved payout paid with a reference; a different person approves                           |
| komisio_list_settlement_candidates     | payouts:propose        | Sellers at or above the payout minimum without an open payout, as ids and öre; no names, no writes             |
| komisio_propose_settlement             | payouts:propose        | Stage one batch that requests and approves a payout per seller; refused whole; a different person approves     |
| komisio_list_day_closes                | accounting:read        | Newest 60 day closes with totals in öre; no accounts, no export                                                |
| komisio_preview_day_close_voucher      | accounting:read        | Voucher lines one day close would export under the tenant's own map, totals, balance, unmapped amounts         |
| komisio_read_accounting_reconciliation | accounting:read        | Per active day: close, export under the current map, Fortnox send status; read only                            |
| komisio_propose_day_close_export       | accounting:propose     | Stage the SIE 4 export of one day close; refused without a map or unbalanced; a different person approves      |
| komisio_read_store_profile             | store:read             | The current public store profile with its version id; untrusted text, no writes                                |
| komisio_propose_store_profile          | store:propose          | Stage the next profile version naming the current one; publishes only for an owner or admin approver           |
| komisio_read_inspection_operation      | inspection:read        | Read exact staged inspection before/after and decision; no reception access                                    |
| komisio_prepare_inspection_reception   | inspection:preview     | Compare a saved draft with reception requirements; unsourced candidates and unassessed next steps only         |
| komisio_preview_inspection             | inspection:preview     | Return unsaved descriptive before/after at the exact saved base revision; no approval or write                 |
| komisio_list_bags                      | inspection:read        | Find a printed bag number or page through bag IDs; no seller data or notes                                     |
| komisio_read_inspection                | inspection:read        | Read bounded saved bag drafts and exact history; no notes, contacts or writes                                  |
| komisio_read_reception_operation       | reception:read         | Read exact staged proposal sources and agreement terms; no decision                                            |
| komisio_list_receptions                | reception:read         | Read a bounded queue with shared next-step guidance, not commercial acceptance                                 |
| komisio_read_reception_history         | reception:read         | Read bounded version summaries, with separate source/review cursors; no images or links                        |
| komisio_read_price_evidence            | reception:read         | Comparable sales in the store by category and text: accepted and sold prices, days to sale; never a price      |
| komisio_read_reception                 | reception:read         | Read one saved session and its source snapshot                                                                 |
| komisio_read_photo_duplicates          | reception:read         | Earlier receptions of the store holding the same photo bytes: session and photo ids and times; no names        |
| komisio_preview_reception              | reception:preview      | Validate a source-bound proposal against the current revision; return an unsaved preview                       |
| komisio_read_reception_photo           | reception:photos       | Read one attached photo at the exact current revision as native MCP image content                              |
| komisio_propose_reception_review       | reception:propose      | Stage a complete review for staff approval; publishes nothing (see docs/STAGED-OPERATIONS.md)                  |

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
  `reception:preview`, `reception:photos`, `reception:propose`, `inspection:read`, `inspection:preview`, `inspection:propose`, `items:read`, `items:propose`, `economy:read`, `sales:read`, `sales:propose`, `ledger:propose`, `lifecycle:propose`, `communications:propose`, `payouts:propose`, `accounting:read`, `accounting:propose`, `store:read`, `store:propose`.
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

With `inspection:propose`, `komisio_propose_inspection_edit` stages description,
category and condition for an existing active saved draft. Pass an explicit stable
request ID, expiry and expected revision; identical retries return the original
proposal. Staff compare the immutable before/after at the same operation queue,
confirm changed fields and approve saving, or reject without confirmation.
A stale or archived draft is never overwritten. There is no price, custody or
seller acceptance in this operation, and no MCP approval tool.
See [staged inspection contract](../docs/STAGED-INSPECTION.md).

Future hosted MCP needs audience-bound OAuth, discovery and scoped delegation;
ordinary Supabase user tokens must not become pass-through HTTP MCP credentials.

## Tool contract and validation

The tool contract is deliberately strict: closed input schemas, an explicit scope
map, stable tool definitions and a clear envelope that states what was and was
not persisted. Komisio's local preview is a first slice; hosted MCP, OAuth and
hosted delegation follows separately. Pending operations already exist.

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

## Preparing an inspection draft for reception

`komisio_prepare_inspection_reception` accepts only bag ID, draft ID and the exact
expected saved revision. It returns candidate description/category/condition,
actual draft provenance and steps to check. It does not read other receptions,
prices or agreements, does not assert they are missing, and does not create source
IDs or a publishable review. The staff inspection page shows the same comparison
under an expandable preparation section. See [contract](../docs/INSPECTION-RECEPTION-PREVIEW.md).

## Find pending operations

The two operation list tools accept status (all/open/expired/executed/failed/rejected)
and optional paired beforeCreated/beforeId from nextBefore. Each returns at most20
summary rows; reuse the cursor exactly without rounding timestamps. Kind is fixed
by the tool and tenant by the host before database limiting. The list is live;
return to the first page for current status. Use the corresponding exact operation
read for details. No payload, identity, actor label or decision reason is listed.
See [discovery contract](../docs/MCP-OPERATION-DISCOVERY.md). These are local stdio
tools, not a new hosted AI assistant or delegated credential.

### Effective store policy

`komisio_get_store_policy` uses `reception:read` and accepts an empty object.
The host pins the tenant. It returns the effective policy with its version/id
(version 0 and null id mean pilot defaults), plus read-only/untrusted/guidance
markers. It cannot publish policy or enable AI. Role and MFA checks are enforced
both at the tool boundary and in SQL. S1 does not add an agent policy-write tool.

### Settlement (P3)

Under `payouts:propose`, `komisio_list_settlement_candidates` returns the
policy threshold and the sellers whose available balance reaches it without
an open payout, as seller ids and öre only; names and contacts stay in the
store. `komisio_propose_settlement` stages one batch (at most 100 sellers,
each once, integer öre, a batch note) at medium risk: a different person
approves in the operations queue, where each seller's balance now is shown
next to the proposed amount; approval requests and approves every payout as
that person and reserves the amounts, refusing the whole batch if any seller
is below the minimum, over its balance or already has an open payout. Neither
tool pays anything; the store pays through its bank and marks each payout
paid. See [docs/SETTLEMENT.md](../docs/SETTLEMENT.md).

### Store profile (P3)

`komisio_read_store_profile` (`store:read`) returns the current public profile
and the version id; `komisio_propose_store_profile` (`store:propose`) stages
the next version naming that id. The profile is public text by definition
(address, contact, opening hours, what the store accepts, concept), so
nothing private leaves the store, but the text an agent proposes is shown to
sellers and customers once published: an owner or admin approves it in the
operations queue, and a staff approval records a failed outcome. See
[docs/STORE-PROFILE.md](../docs/STORE-PROFILE.md).

### Seller economy reads (P2 S14)

Opt in with `economy:read` for `komisio_read_seller_balance` and
`komisio_read_seller_ledger`. Both take only `{ sellerId }`; the host pins
the tenant. Balances come from the shared SQL engine and amounts are signed
integer **ore**, not SEK. Missing/foreign sellers fail instead of appearing
as a zero balance. The ledger returns at most 50 recent entries and explicitly
marks possible truncation; it is not a complete statement or an atomic snapshot.
Do not sum this partial history to infer the seller balance. Free-text reasons,
contact data and actor identities are omitted. Unsafe integer amounts fail
closed. These tools cannot adjust a balance, approve a payout or send messages.
Local MCP scopes remain tool restrictions on a user token, not separately
scoped database credentials. All ordinary role and MFA checks still apply.

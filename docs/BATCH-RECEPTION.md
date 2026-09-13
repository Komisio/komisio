# Batch reception (Astra task 3)

One seller's existing reception can supply up to three photos and twenty total
sources. The optional assistance port proposes up to eight garments. It groups
views, cites each row's sources, retains tentative facts and requires supplied
price evidence or an actionable question. The model cannot supply seller/store
identity, storage paths, agreements, approval or engine commands.

## Staff journey

1. Start a reception for the seller and upload the photo set. Add relevant
   observations and price evidence. This parent reception is the source set;
   review the individual child garments, not the whole set as one garment.
2. Select **Several garments** in the assistance panel and analyze. Missing
   provider configuration remains unavailable; the manual single-item flow stays.
3. Review each row's description, evidence, proposed price and assigned images.
   An overview may show several garments. Unclear grouping requires staff judgment.
   Dismiss an unwanted row, or gather missing evidence before another analysis.
4. Check every included fact, the price and the row's final confirmation. This
   prepares one separate reception and queues the existing
   `publishReceptionReview` operation. It does not publish a review immediately.
5. Open the operation, review and approve or reject through the existing queue.
   Each garment has its own operation. Subsequent custody, policy-dependent seller
   consent and commercial acceptance are unchanged and remain separate.

## Persistence, retries and authority

The split result is transient, as with single-item assistance. Reload loses rows
that have not been prepared. Completed rows are durable receptions and operations
in the ordinary queues. Local dismissal is not an audit event or a persisted
business decision. No new batch table is introduced.

The staff session prepares a reviewed row through `createReception`, immutable
photo upload (original plus seller derivative), `saveReceptionSources` and
`proposeOperation`. All use existing engine checks and storage/RPC permissions.
The batch attempt must exist for the same tenant, parent and source revision.
The parent is re-read before staging. No custody, item, consent, sale, payment,
notification or publication is created by preparation.

Namespaced UUIDv8 request ids derive from tenant, parent, revision, batch attempt,
row index and purpose. A lost-success retry uses the same request and cannot
create a second child/operation. Changed payloads conflict with existing engine
replay checks. The UI locks the payload after its first submission. Preparation
is a sequence, not one database transaction: a failure may leave an empty child
or saved source snapshot. Retry in the same tab reuses it. If the parent changed
or the tab was lost, inspect the reception/operation queues before starting anew.
Do not delete partially prepared records or treat them as accepted inventory.

Photo bytes are read only through authorized parent sources and copied through
`uploadReceptionPhoto` into the child's own paths. Original parent paths are
never placed in child snapshots and storage RLS is not broadened. Shared images
are possible because all rows belong to the same seller; staff must still inspect
those images before staging. Copies increase storage use.

## Provider and limits

`runReceptionAssistance` remains the entry for single and batch requests. Both
use the same tenant policy, explicit provider configuration, image preprocessing,
quota reservation, role/revision rechecks and abort deadline. Batch uses the
separately pinned `reception-batch-v1` prompt and a maximum 8,000 output tokens.
The additive migration only admits that exact prompt version to the existing
reservation function; its grants, replay, cooldown and quota checks are unchanged.
One batch reserves one assistance attempt, not eight. Real cost depends on images
and output; a batch is not promised to cost the same as a single item.

No live key, paid call or tenant activation is introduced. The local HTTP provider
fixture blocks external network and labels output synthetic. Unit tests exercise
split/source/price boundaries and partial preparation; pgTAP exercises prompt,
identity, replay and budget boundaries; the dedicated browser fixture exercises
two photos, per-row review, dismissal, lost-success retry, separate staged
operations and explicit publication without commercial acceptance.

Owner pilot work remains: real images/provider quality and grouping evaluation,
price evidence workflow, connected camera/printer and end-to-end store practice.
A durable batch inbox and cross-tab resume can be considered after pilot feedback.

## Release / recovery

The task PR records the final SHA, required CI and staging deployment. The local
migration is immutable once applied. Revert application changes through a PR if
preparation regresses; leave the additive prompt allowlist/history intact. The
existing provider configuration remains the assistance kill switch. Do not remove
child sources or pending operations to hide partial preparation; use existing
review/rejection and inspect the queues. No new live service is a deployment step.

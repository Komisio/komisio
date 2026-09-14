# Zettle product image export

The owner/admin action **Export product photo** on the Zettle integration page
sends one image for an already exported item. It is deliberately separate from
stock initialization, including for items with a held stock attempt.

## Source and privacy

The engine chooses the first photo, in stored array order, from the source
revision of the item's accepted reception review. A later reception edit never
silently changes the exported photo. Inspection drafts, purchases and reviews
without photos report no photo; no seller avatar, document or unrelated image is
substituted. Replacement and removal are not part of this slice.

Storage downloads use the current user's session and existing RLS. The server
decodes and orients the image, strips metadata, and uploads a JPEG no larger than
1536 pixels per side and 1 MiB. Both dimensions must exceed 50 pixels. Private
originals and signed Storage URLs are never sent to Zettle. Visible people,
labels and other content are not automatically redacted: the UI makes clear
that the reduced copy becomes product imagery at Zettle.

## Retry and concurrency

An immutable intent binds tenant, item, exact source, merchant and product.
Only its first successful claimant may upload a file. Concurrent commands and
different request IDs converge on the same intent. If the upload response is
lost, stop for manual reconciliation; do not delete the claim or silently upload
again. An uploaded but unattached image may remain orphaned at the provider.

The returned first image URL is allowlisted and persisted before product
association. Association uses `presentation.imageUrl`, not the deprecated
`imageLookupKeys` write contract, with an exact product snapshot and `If-Match`.
A retry observes the desired URL instead of repeating the PUT. Another image,
unmanaged fields or concurrent edits stop the update. Existing provider colors
and lookup metadata are preserved when associated with our registered image.
Later live product/price exports preserve the registered photo.

There is no transaction spanning Supabase and Zettle. Authorization and current
item snapshots are checked before transport writes; a concurrent POS sale or
external image edit can still race the network. Image commands never enable
tracking, grant stock, change prices deliberately or record sales. Their upload
and association stages do not imply stock success.

## Deployment and verification

Apply `20260915190000_zettle_images.sql` before deploying the application. It adds
integration metadata and narrow owner/admin RPCs; no core table, Storage policy,
service-role client or dependency is introduced. Preserve these records on
rollback. Removing the pilot binding disables transport access.
Until the new RPCs are installed, the photo action is hidden and ordinary stock
export retains its previous behavior. Only PostgREST's missing-function code is
treated as an uninstalled slice; authorization and other read failures still stop.

Tests cover exact accepted-source selection, role and tenant boundaries,
immutability, one-upload claims, safe URLs, metadata minimization, lost responses,
conditional association, price-update preservation and concurrent commands.
The existing browser journey checks denial without a pilot connection. Real
merchant upload/appearance must still be verified after deployment; unit HTTP
fixtures do not establish live provider acceptance.

Protocol references: [upload an image file](https://developer.zettle.com/docs/api/image/user-guides/upload-product-images)
and [associate a product image](https://developer.zettle.com/docs/api/product-library/user-guides/manage-images/add-product-images).

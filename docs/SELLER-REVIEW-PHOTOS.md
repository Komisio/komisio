# Images in the seller's exact review

The mobile review displays the derivative image IDs pinned at publication, then
the seller can approve or decline the same review. This is still a review of a
proposed selling price and terms, not commercial acceptance or a payout.

## Capture and publication

New staff uploads pass through `uploadReceptionPhoto`, which decodes the image,
retains the private original and stores an immutable reduced JPEG in the private
`seller-reception-photos` bucket. Shared `lib/media/` code orients, resizes and
removes embedded metadata. It does not remove visible people, address labels or
other objects. Staff must inspect what the photo actually shows before sharing.
Other direct Storage adapters remain responsible for preparing safe derivatives;
the application read route decodes/minimizes again rather than trusting them.

An insert trigger pins available derivative IDs from the exact source revision
into `reception_reviews.photo_sources`. Later uploads cannot change that list.
Existing reviews default to an empty list, with no backfill. An older original
without a derivative remains internal; its absence does not fabricate an image.
Upload the photo again with a new ID and publish a new review to include it.
The operator sees the included photo count after publication.

Stored objects cannot be overwritten, moved or deleted by authenticated clients.
Original upload, derivative upload and attachment are retryable but not one
transaction; a failed step can leave a private orphan. Retention cleanup remains
separate work. This slice does not invent a camera or wall-device identity.

## Access boundaries

1. The app obtains an exact derivative path through `read_seller_review_photo`.
   Its private helper checks verified account email, enrolled MFA, current link,
   exact review, source revision and expiry. No staff membership is required.
2. A normal user-authenticated Storage client downloads that path with
   `x-komisio-review-token`. Storage RLS repeats the same capability checks.
   No service-role key, broad seller membership or signed URL is used.
3. Seller access accepts only Storage's server-assigned
   `object.get_authenticated` and `object.get_authenticated_info` operations.
   Supabase's operation helper normalizes the optional `storage.` prefix.
   Hosted Storage uses the info operation before serving a private download;
   it needs the same exact recipient/capability checks as the download itself.
   Listing and URL signing fail
   even when the seller possesses the correct token. An arbitrary HTTP header
   cannot set that database operation. Missing/older operation support fails closed.
4. The app responds with a JPEG, private/no-store, no-referrer and nosniff headers.
   It does not use the image optimizer. The mobile UI prevents approval while
   an included image is missing or failed; decline stays available. This is a UI
   affordance, not proof that a person looked at the pixels.

Revoking/replacing the link, changing source/review, expiry or requiring MFA
blocks the next download. Already downloaded images cannot be recalled. Staff
still have their existing authenticated read access. Do not log capabilities or
put this route behind a public cache.

This uses Supabase's [operation-aware Storage RLS](https://supabase.com/docs/guides/storage/security/access-control).
Unlike [signed URLs](https://supabase.com/docs/guides/storage/serving/downloads),
each application image request returns through current authorization.

## Verification and deployment

Apply additive `20260912030000_seller_photos.sql` before the application. A prior
application may omit images while the immutable lists remain intact; prefer a
forward fix or disable the intake pilot to rollback behavior. Never make a bucket
public as a compatibility workaround.

Hosted compatibility also requires `20260912060000_seller_photo_info.sql`.
The initial rule allowed downloads but denied the hosted info preflight with
`NoSuchKey`, even though the pinned file existed. The regression suite first
reproduced this through the real local HTTP info endpoint. No stored review or
object changes are required. If either the authorized image or denial checks fail
after deployment, pause the pilot and use a forward fix; do not broaden policies.

`npm run test:seller-photos` uses the actual local Storage HTTP service, ordinary
user JWTs and synthetic images. It covers info preflight, metadata removal, immutable retry,
identity/header/MFA denial, no original access, no signing/listing and immediate
revocation. The test refuses a non-local Supabase URL. pgTAP additionally covers
pinned-list stability and direct SQL policy boundaries. The mobile browser
journey uploads a synthetic image, publishes, signs in as a separate seller,
loads the image, approves and then verifies revocation. Fixtures are never live AI.

Self-hosters need Storage operation/header propagation. Tested locally with
Storage v1.72.1; hosted compatibility must be checked independently. A staging
health check alone is not a positive authenticated seller-image test.

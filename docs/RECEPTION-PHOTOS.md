# Private staff reception photos

The operator workspace now accepts JPEG/PNG uploads through the shared
uploadReceptionPhoto operation. Files are capped at 3 MiB, 8192 pixels per edge
and 20 million declared pixels. App uploads now fully decode before storage and
create a reduced JPEG alongside the original. Signature/dimension checks also run
on download, independent of claimed MIME type. None of these checks establishes
authenticity or proves that a garment matches a seller. Original
bytes and embedded metadata are retained privately. The separate optional
[assistance adapter](RECEPTION-ASSISTANCE.md) decodes and minimizes derivatives
before any explicitly configured provider transmission; originals are not sent.

The private reception-photos bucket has matching size/type restrictions and
Storage RLS bound to a real tenant/session path. Staff may insert and read;
readonly may read; confirmed identity and enrolled MFA are enforced by the shared
database role check. Restrictive policies prevent broad policies for other buckets
from exposing or modifying these originals. No authenticated overwrite, move or
delete is permitted. Service-role keys are not used by the application.

This follows Supabase's documented [private bucket model](https://supabase.com/docs/guides/storage/buckets/fundamentals)
and [Storage access policies](https://supabase.com/docs/guides/storage/security/access-control).
The original files use immutable random IDs under tenant/session paths. Publishing
a photo source independently requires an existing object in that exact scope;
an arbitrary object URL or model-generated path is insufficient. A directly
uploaded object's content is still untrusted and revalidated when consumed.

Original upload, derivative upload and source attachment are separate steps. A
lost upload response can retry the same random paths only if all bytes match.
The derivative is capped at 1536 pixels per edge and 1 MiB, oriented and stripped
of embedded metadata using the shared media adapter. Attachment uses the existing
actor-bound request and expected source revision. A failed attachment can leave a
private orphan; do not delete originals ad hoc. Retention, orphan cleanup and
account deletion require a separately designed administrative process before an
external pilot. Users can reload to inspect saved state after a conflict.

Images are served through an authenticated, uncached route with no signed/public
URL and no image-optimizer cache. The route reads the current source snapshot;
historical image navigation is not yet a surface. Originals remain staff-only.
The [seller photo adapter](SELLER-REVIEW-PHOTOS.md) shares explicitly pinned
derivatives through separate capability-bound Storage policies. No camera
hardware integration or outbound mail is claimed; live inference requires the
separate optional provider configuration.

Apply additive 20260912015000 and 20260912030000 before app deployment. Keep both
buckets private.
Rollback should disable the intake UI or use a compatible prior app while keeping
immutable evidence. A prior app that explicitly rejects photo sources cannot edit
these sessions; prefer a forward fix. No destructive rollback is provided.

Tests use both real local Storage and pgTAP: private bucket, scoped insert/read,
missing-object rejection, readonly/unrelated/MFA denial, immutable bytes, retry,
invalid image content and anonymous/public denial. Concurrency tests still apply
every migration, with a minimal Storage metadata fixture in their disposable DB;
this does not replace the real Storage browser journey.

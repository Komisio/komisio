# Try the reception pilot

Use a test store and fictional seller, garment and terms. The staging environment
is not ready for real consignment or financial records. Staff review and seller
decision are implemented; physical camera pairing and live model quality are not
verified. No link or email is sent automatically by this flow.

## Staff preparation

1. Sign in and select your test store. Its owner/admin should publish clearly
   fictional seller terms under Receiving → Seller agreements.
2. Register a test seller. For a complete mobile walkthrough use an email address
   controlled by the tester with a verified account; do not substitute a stranger's
   address or pretend an unverified account is verified. No staff membership is
   needed for that seller account.
3. Open garment reception from Receiving, find the seller and start a session.
   Save a JPEG/PNG of a non-sensitive test object. Check the displayed photo.
4. In manual mode, save a description and a fictional appraisal with its evidence
   source and rationale. This creates a new source version. The price is a proposed
   selling price, not the seller payout.
5. If the [optional provider](RECEPTION-ASSISTANCE.md) is explicitly configured,
   generate suggestions from the saved evidence instead. Check each fact and
   source. Missing price evidence remains a question, not an invented valuation.
6. Review the description, photos, proposed price and full terms, then publish.
   Check the included photo count. Older photos without prepared copies are not
   retroactively added; upload again with a new ID and publish a new review if needed.
7. Create the personal link and copy it immediately. A replacement invalidates the
   old link. The app does not email it automatically.

## Seller decision

Open the link in the seller's browser and sign in with the same verified email.
Complete MFA if enrolled. Review the image, description, price and exact terms.
Approve after checking the acknowledgement, or decline without approving. If an
image fails, reload; the interface blocks approval while that image is unavailable.

Return to the staff session and reload to see the saved response. A new source
version requires a new published review and response. Revoking a link blocks
subsequent review/image requests, but cannot recall already downloaded pixels.

Do not confuse this response with BankID signing, commercial acceptance,
inventory publication, a general seller-portal account or a payout request.

## If something does not work

- **AI unavailable:** manual mode works; do not paste model keys into the browser
  or assume the intended 199 SEK plan includes unlimited inference.
- **Review unavailable:** check the account, current link, source/review version
  and expiry. Reopen the link after signing in or recovering the account.
- **Image missing:** reload first. Check the included photo count and whether the
  review predates image sharing. Never make the Storage bucket public to fix it.
- **Save conflict:** reload the saved state before making a new change. Retrying
  the same request is different from replacing somebody else's later edit.

Automated validation uses synthetic accounts and images in local Supabase,
including real Storage, separate seller identity and mobile error/revocation
journeys. [CI](https://github.com/Komisio/komisio/actions/workflows/test-db.yml)
records the exact tested revision. A hosted health check does not replace an
authenticated seller-only pilot walkthrough.

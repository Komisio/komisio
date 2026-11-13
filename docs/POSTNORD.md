# Central intake shipping

The central intake shipping endpoint is
`POST /api/mobile/v1/external-items/shipping`. It requires the existing verified
phone identity, MFA/recovery checks and item ownership. Ordinary store
handovers do not use this endpoint.

`read` takes `offerId`. `book` also takes a durable `requestId`, a Swedish
`address` (`street`, five-digit `postalCode`, `city`). Legacy callers may also
send integer `weightG`, `lengthMm`, `widthMm`, `heightMm`, all together, ordered
longest first. New callers omit all four; unknown measurements stay null and
are omitted from the carrier request, never estimated. `read` advertises
`measurementsOptional: true` so updated apps do not send simplified bookings to
an older backend. Old pending commands retain their original payload.

The read response also advertises `bundlingAvailable: true`, `eligibleItems`
and the booked parcel’s `items`. A new booking may include `offerIds` (1–10
unique IDs including `offerId`) to combine accepted, fully onboarded, unreceived
items owned by the same seller in the central tenant. Omit measurements for
this command. Selection order is irrelevant to replay; changing the selection
or reusing any already-booked item is rejected atomically. An item belongs
to at most one parcel. All selected items show the same code and contents; the recipient and seller
contact details are supplied by the server/database, never by the app.
PostNord field limits are checked before dispatch: street 50, city 35, name 60
and email 70 characters. An incompatible saved profile is refused for staff
assistance rather than truncated or sent as an invalid booking.

`POST /api/mobile/v1/external-items/shipping/address` reads the phone owner's
central seller address with `{action: "read"}`. Saving takes `action: "save"`,
`requestId`, `tenantId`, `sellerId`, `expectedRevision` and `address`. It changes
only the existing central seller's address fields and appends a profile revision.
The database pins ownership and the central tenant; ordinary store profiles,
membership, contact identity and previously booked parcels are unchanged.
Profile conflicts require a fresh read; an uncertain save retries the same ID.

The label keeps the originating H-reference. Staff opening any linked handover
see the complete parcel contents and links to each separate receipt. Booking
does not merge handovers or confirm receipt. Legacy grouped handovers still
require assistance and cannot be split into parcels.

## Configuration and verification

Use a PostNord Developer customer subscription for the central recipient's
business contract. Obtain an API key and authorized customer number from PostNord.
Use separate portal applications and keys for sandbox and production. An assigned
Booking application ID can be configured, but is omitted when empty. Booking
3.5.29.1 Swagger requires only `name` within `application`; the integration guide
separately asks for a PostNord-assigned ID in production. Omitting it is therefore
a compatibility test; an owner-run production booking subsequently succeeded.
That does not establish service eligibility or final billing. Never substitute the
guide's example ID. Production bookings may incur contract charges.
The implementation calls Booking v3
`/rest/shipment/v3/returns/edi`, service 24 with Print Label C2, and displays the
returned QR image. It requests neither SMS nor email delivery of the QR.

References:

- [Booking API and prepaid trade-in QR codes](https://portal.postnord.com/se/en/resources/integrations/api/booking-api/)
- [Booking v3 schemas and examples](https://guide.developer.postnord.com/)
- [Booking API Swagger, inspected version 3.5.29.1](https://developer.postnord.com/apis/details/7SnWopsBdefNMJq7T-pg)
- [PostNord Return service](https://www.postnord.se/foretag/skicka/returer/postnord-return/)
- [Developer Portal](https://developer.postnord.com/)

Keep `KOMISIO_POSTNORD_ENABLED=false` until configured. The other server-only
environment variables are listed in `.env.example`. `sandbox` uses
`atapi2.postnord.com`; `production` uses `api2.postnord.com`. No caller can choose
the provider host, payer, service or API key.

The database operator must provision the single private
`komisio_private.central_shipping_runtime` row with the central recipient's
tenant, matching environment, SHA-256 hash of the random 64-character hex
`KOMISIO_SHIPPING_SERVER_KEY`, and recipient contact JSON:
`name`, `street`, `postalCode`, `city`, `country: "SE"`, E.164 `phone`, `email`.
Use secret management and parameterized operator tooling; never commit addresses,
customer numbers, keys or real shipment replies. The API key and customer number
remain in server configuration, not in the mobile app or database replies.

Before general availability, book a synthetic sandbox parcel and confirm:
the sender is the private person, the recipient is the contracted company,
the company pays, and the code prints the intended label at a service point.
The app labels sandbox codes as test bookings. The EDI sends the package weight
in KGM and item dimensions in CMT, as defined by Booking 3.5.29.1. QR generation
explicitly requests PNG, STANDARD service-point printing and onlyQRCode.
Do not treat mocked tests as provider acceptance.
Owner-authorized production testing may precede service-point verification;
record provider rejection or uncertain outcomes without automatic rebooking.

### Sandbox probe

Development need not wait for production activation. PostNord's developer guide
describes a separate Sandbox plan and test API key through the AT Developer
Portal. Confirm access to Booking v3 and obtain the customer number intended for
that test account. The application ID is optional when unassigned. Documentation examples are not evidence
that an arbitrary ID is authorized. A successful sandbox request does not confirm
production contract eligibility or charges.

Use the same booking adapter without touching Supabase, accepting offers or
enabling shipping in an application environment. Place these values in an ignored
local `.env.postnord-sandbox` file, using **test** credentials only:

```dotenv
POSTNORD_SANDBOX_API_KEY=
POSTNORD_SANDBOX_APPLICATION_ID=
POSTNORD_SANDBOX_CUSTOMER_NUMBER=
```

```sh
node --env-file=.env.postnord-sandbox --import tsx scripts/postnord-sandbox.ts --check
node --env-file=.env.postnord-sandbox --import tsx scripts/postnord-sandbox.ts --book first-test
node --import tsx scripts/postnord-sandbox.ts --inspect first-test
```

`--check` performs no network request. `--book` sends one synthetic 1 kg,
40 × 30 × 20 cm return to `atapi2.postnord.com`, using service 24/C2 without
carrier email or SMS. Production environment variables are never a fallback.
The attempt, validated reply and QR PNG are stored under the ignored
`private/postnord-sandbox/<run-id>/` directory. No secret or raw provider error is
printed. Run IDs cannot traverse outside this directory.

A durable exclusive attempt file prevents repeat or concurrent dispatch with the
same run ID, including interrupted runs. Use `--inspect` after a lost response;
do not delete its evidence or choose a new ID to bypass an uncertain result.
HTTP 401/403 indicates an access problem; 400 requires checking request/account
requirements; 429 or 5xx requires provider investigation before a new attempt.
The probe records all failures as unconfirmed rather than inventing a rejection.
Sandbox codes must never be used to send a real parcel. Inspect the returned code
and label/direction before general availability.

## Uncertain bookings and receiving

The database atomically claims one dispatch. A concurrent or repeated command
returns the same parcel without another provider POST. The booking's message ID
is unique and bounded; the carrier is not assumed to deduplicate it. A timeout,
malformed reply or missing confirmation holds the parcel for review. Never clear
the claim or retry with a new ID to work around an unknown outcome.

The operator reconciles held parcels with PostNord using the package/booking
reference. This version has no automatic rebooking or cancellation; resolution
must preserve the original evidence through a reviewed engine operation.

The label includes the internal H-reference for staff receiving. The seller sees
PostNord's code, not the internal H QR. Staff still confirm actual physical
receipt through the existing receiving operation; only that operation starts
the guarantee. Tracking links do not change custody or seller balances.

New central offers have separate H-handovers. Pre-existing grouped handovers are
preserved and refused by one-item booking; staff must arrange their shipping
without splitting immutable handover links or receiving unarrived items.

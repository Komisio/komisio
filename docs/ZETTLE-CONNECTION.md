# Zettle API-key pilot connection

The owner supplied clientId and an API key in Vercel, not a client secret.
The official [assertion grant](https://developer.zettle.com/docs/api/oauth/user-guides/set-up-app-authorisation/set-up-authorisation-assertion-grant)
exchanges that key for a short-lived access token. The server then calls
`https://oauth.zettle.com/users/self`. Only the merchant UUID, check time and
whether it matches a configured pin reach the browser. Neither credential,
access token, provider error body nor user profile is logged or returned.

## Configuration and verification

In the staging project's Production environment, configure server-only variables:

- `ZETTLE_CLIENT_ID` and sensitive `ZETTLE_API_KEY`: supplied by the owner.
- `ZETTLE_PILOT_TENANT_ID`: the explicit Komisio tenant UUID approved by the owner.
  Missing or mismatched tenant means no provider request, even for administrators.
- `ZETTLE_MERCHANT_ID`: optional for first read-only discovery. After verifying the
  returned merchant, pin that UUID here. Subsequent checks reject a different
  merchant. Changing credentials does not silently accept a new pinned merchant.

Publish after the configuration is saved. As owner/admin of the selected store,
open Intake → Zettle integration → Check Zettle connection. Existing MFA and
SQL tenant-role checks apply before the adapter receives credentials. The request
body accepts a tenant ID only; this is not a credential upload endpoint. Requests
with a foreign origin, switched tenant, anonymous identity or insufficient role
are denied. There is no default pilot credential for all stores.

This is a read-only connection diagnostic, **not live sync activation**. It does
not create products, initialize inventory, query purchases or import old sales.
Success establishes credential/merchant identity, not Product or Purchase scopes,
VAT configuration, a safe synchronization window or POS inventory behavior.
The existing synthetic synchronization remains loopback-only.

## Storage and multi-tenant path

Current pilot secrets remain in Vercel; no new SQL credential table or service-role
client. The server-side environment is a single explicit pilot slot, not the final
self-service model. Future per-tenant connection work needs an appropriate Zettle
partner-hosted authorization flow, encrypted credential lifecycle, grant/revoke,
merchant binding, rotation and audit. The app's normal membership model remains
unchanged. Do not extend the pilot by falling back across tenants.

## Verification and release

`tests/unit/zettle-auth.test.ts` covers the exact token request, tenant denial,
merchant mismatch, malformed/expired token responses, redacted failures and role
checking before network access. `tests/e2e/zettle.spec.ts` covers the new protected
route alongside the full existing synthetic product/sale loop.

Local command: set `KOMISIO_INTAKE_ENABLED=true`, configure local Supabase and run
`node node_modules/@playwright/test/cli.js test tests/e2e/zettle.spec.ts`.
No real API key is needed for automated tests. Never use the pilot credentials in
CI or fixtures. No migration is required. If necessary, remove the pilot tenant
variable and redeploy to disable diagnostics; no financial rollback is involved.

## Missing check button

The button is present only when the deployed server configuration is ready.
Client IDs are opaque strings (not necessarily UUIDs); surrounding pasted
whitespace is removed from the four environment values before both validation
and transport. The tenant UUID must still match exactly. Owners/admins see
fixed missing-client, missing-key or invalid-merchant messages only after that
tenant match; other stores receive the generic unavailable message. No values
are sent to the client. Save Production variables and redeploy: merely editing
Vercel settings does not update an existing deployment.

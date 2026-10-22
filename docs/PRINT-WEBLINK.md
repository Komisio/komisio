# Weblink operations

The original operator-managed pilot and the managed gateway share the same
per-device authentication and queue fencing. The managed gateway supports
owner/admin provisioning from Komisio without server installation per printer.
Physical TLS trust, authentication, reconnect, exact copies and revocation must
be verified for each supported printer/firmware before routine store use. A local
Printer Setup Utility label does not establish Weblink compatibility.

The bridge uses an existing anonymous device identity and the scoped queue RPCs.
No service-role key or extra store membership is needed. The Weblink schema and
owner/admin setup must be available in the target environment. Keep deployment
separate from activation; installing this package cannot activate a printer.

## Managed setup from Komisio

Run one gateway per environment with a distinct Unix user, state directory,
host, encryption key, proxy secret and management secret. Never share device
state between staging and production. Multiple printers in a store have separate
identities, connections and queues. The gateway defaults to 32 printers across
stores, with a configurable maximum of 64; measure resource use before raising
capacity. Each accepted printer owns a separate worker and durable journal.

Use the same reviewed runtime package described below. The managed CLI accepts
one service-owned 0600 configuration file:

```json
{
  "url": "https://PROJECT.supabase.co",
  "publishableKey": "sb_publishable_REPLACE",
  "host": "print.example.com",
  "port": 18655,
  "capacity": 32,
  "directory": "/var/lib/komisio-weblink/production/registry",
  "encryptionKeyFile": "/etc/komisio-weblink/production/key",
  "proxySecretFile": "/etc/komisio-weblink/production/proxy-secret",
  "managementSecretFile": "/etc/komisio-weblink/production/management-secret",
  "caBundleFile": "/etc/komisio-weblink/production/ca.pem"
}
```

Use a random 32-byte binary encryption key and **different** random 43-character
base64url proxy/management secrets. All configuration files must belong to that
environment's service user with mode 0600; state directories use 0700. The
registry is encrypted and locked for the gateway's lifetime. Its stored host
and Supabase endpoint/key binding must match configuration on restart.

Install `komisio-weblink@.service`, an immutable reviewed release and the
environment-specific `current` symlink. The template expects users named
`komisio-weblink-staging` / `komisio-weblink-production` and matching paths.
Keep the original pilot's service and paths separate when adding a gateway.

The TLS proxy must forward `/manage/*`, `/weblink/*` and `/healthz` to the
environment's loopback port and overwrite the three proxy headers as in the
pilot example below. `/manage/*` additionally requires the application's private
Bearer management secret; browser Origin requests are refused. Never log those
headers. Use a valid automatically renewed certificate, RSA 2048 and TLS 1.2+
for the verified older Link-OS firmware. The service cannot validate the external
proxy's certificate itself: verify the hostname and actual chain before enabling
setup. `ca.pem` must contain only current CA certificates trusted to validate
that chain. The installer includes these as `WEBLINK1_CA.NRD`, followed by the
printer's scoped authentication and HTTPS location. It does not disable TLS or
restart a printer. Monitor expiry/chain changes and test a renewed chain before
replacing printer trust files.

Configure these **server-only** application variables in the matching environment:

- `KOMISIO_WEBLINK_MANAGEMENT_URL=https://print.example.com`
- `KOMISIO_WEBLINK_MANAGEMENT_SECRET` matching that gateway's management secret
- `KOMISIO_WEBLINK_SETUP_ENABLED=true` after gateway and database verification

The owner/admin creates an inactive Weblink printer under printing settings,
chooses **Prepare connection**, then **Download installation file**. The server
checks identity/MFA, active tenant and database ownership before enrollment and
again before returning credentials. It uses existing one-use pairing and device
RPCs, not a service-role key. A retry resumes the same encrypted enrollment;
unknown results never create another gateway generation automatically.

On the printer's local network, send the downloaded file to the intended printer
using Zebra Printer Setup Utility's **Available Files**; see the official
[iOS guide](https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/software/psu-iOS-ug-en.pdf).
Finish the transfer before restarting. Delete downloaded credential files after
installation. Then explicitly enable printing in Komisio, refresh device status
and send one supervised test label. An inactive printer cannot authenticate its
printing channels. A download or a device heartbeat is not physical acceptance.

Replacement requires pausing the printer and revoking its prior identity; the
gateway keeps the old generation and its evidence. Held results and crash locks
require the recovery procedure below. Deployment creates no device, enrolls no
store and activates no printer. To roll back enrollment availability, disable
the setup flag while preserving recovery controls and all device state. Stop a
gateway to stop dispatch, retain its state and restore a compatible reviewed
runtime only after reviewing any uncertain in-flight work.

The following sections describe the original single-device operator workflow.

## Install the reviewed runtime

Use Node 24 LTS, one dedicated `komisio-print` user and local persistent Linux
storage. Run the native bridge tests and review the release revision first.
Prepare a new empty absolute output path from that revision:

```sh
node scripts/print-bridge/package-runtime.mjs /absolute/new-release
cd /absolute/new-release
npm ci --omit=dev --ignore-scripts
```

The package contains only the bridge, its pinned `ws` dependency manifest/lock,
license and notice. Install it in a root-owned immutable release directory under
`/opt/komisio-print/releases/`; `/opt/komisio-print/current` points to the reviewed
release. Do not run the full application as root or install the old unauthenticated
spike. Verify the archive checksum before unpacking.

Create private service-owned directories `/var/lib/komisio-print` and
`/etc/komisio-print` (0700). Provision a random **32-byte binary** encryption key
at `/etc/komisio-print/key`, and a separate random **43-character base64url** proxy
secret at `/etc/komisio-print/proxy-secret` (0600). Never print these values, store
them in the repository or back up the encryption key alongside encrypted state.
The service-owned 0600 `/etc/komisio-print/pilot.json` contains:

```json
{
  "url": "https://PROJECT.supabase.co",
  "publishableKey": "sb_publishable_REPLACE",
  "tenantId": "10000000-0000-4000-8000-000000000001",
  "printerId": "20000000-0000-4000-8000-000000000002",
  "deviceName": "Pilot Zebra",
  "host": "print.example.com",
  "port": 18654,
  "pollMs": 3000,
  "enrollmentDirectory": "/var/lib/komisio-print/pilot",
  "encryptionKeyFile": "/etc/komisio-print/key",
  "proxySecretFile": "/etc/komisio-print/proxy-secret"
}
```

Use the target store/printer IDs, not these examples. The public key must be a
publishable/anon key. Remote Auth/RPC endpoints must use HTTPS. Numeric loopback
HTTP is reserved for local tests.

## Enroll without losing the one-use pairing

Obtain the existing one-use pairing code as the store owner/admin. Pass it to
the CLI through private standard input, never a command-line argument or shell
history. Run as `komisio-print`:

```sh
node /opt/komisio-print/current/scripts/print-bridge/cli.mjs enroll /etc/komisio-print/pilot.json
```

Input is the code followed by EOF. Enrollment persists the anonymous session
encrypted before consuming the code. An uncertain pairing is reconciled by
reading that same identity's context; rerunning with empty input never resubmits
the code. A wrong store/printer/transport refuses credential publication. Inspect
and revoke any unintended pairing through the owning store before starting over.

Unknown signup or refresh outcomes stop for operator review. Do not delete the
checkpoint to retry automatically. A failed refresh may require revocation and
a new identity. Existing roles and server authorization are never bypassed.

Successful enrollment creates private `binding.json` and `printer-setup.zpl`
files inside the enrollment directory. The latter **contains the printer
password**. Transfer it only through the trusted local printer configuration
path and remove exported/downloaded copies afterward. The encrypted checkpoint
retains the provisioning password; runtime credentials retain only its digest.

Load and verify the trusted CA chain before applying the setup file. The generated
SGD commands set the host credential and HTTPS Weblink location, then enable Weblink.
They do not restart the printer, disable certificate verification or install a
CA certificate. Verify/load the appropriate trusted chain and reboot only after
checking pending local output. See Zebra's [Weblink SDK certificate guidance](https://techdocs.zebra.com/link-os/latest/webservices/)
and [configuration guide](https://techdocs.zebra.com/link-os/2-13/webservices/content/link-os-pg-addendum-en.pdf).

## TLS proxy and service

In the owner's printing settings, create a Weblink printer and its one-use code,
enroll the service, and refresh the device list. Select the paired device and
acknowledge supervision to **enable the pilot test**. This permits queued and
new jobs; it does not mark hardware acceptance complete. The default-off setup
flag gates enabling. Pausing remains available even when that flag is off.
An unresolved dispatch prevents reactivation. Pause cannot recall labels already
sent; an attempt racing a pause may be held and need the recovery below. Do not
use pause/reactivation to clear an uncertain attempt.

The listener binds only to `127.0.0.1`. The TLS proxy must **overwrite** Host,
`X-Forwarded-Proto` and `X-Komisio-Bridge`; forwarding client-supplied versions
is unsafe. A Caddy route inside the approved HTTPS site can use:

```caddyfile
handle /weblink/* {
    reverse_proxy 127.0.0.1:18654 {
        header_up Host print.example.com
        header_up X-Forwarded-Proto https
        header_up X-Komisio-Bridge {$KOMISIO_BRIDGE_PROXY_SECRET}
    }
}
```

Supply that variable through a protected service environment file with the same
value as `proxy-secret`. Keep TLS verification and automatic renewal enabled.
Validate the Caddy configuration before reload; do not log Authorization headers.
Do not open the bridge port or printer port 9100 to the internet.

Install the supplied `komisio-print.service`; `/opt/komisio-print/node` must point
to a root-owned supported Node installation whose official download checksum was
verified before unpacking. `Restart=no` is intentional: a crash leaves an
ownership lock. Start only after enrollment and explicit pilot activation are
ready. The service polls serially every three seconds by default. It sends a
device heartbeat each minute; reachable means authenticated channels, not a
confirmed physical print. An uncertain attempt stops intake but keeps reporting.

`cli.mjs status /etc/komisio-print/pilot.json` reads local connection status.
Use `journalctl -u komisio-print` for fixed state transitions and systemd for
process health. Local `/healthz` exposes connection/closing booleans only.
Check certificate expiry and service failure in the host's monitoring; no external
notification channel is automatically installed.

## Stop, recover and roll back

1. Stop the service and confirm its process/control group has exited. Never
   remove locks using an age/PID heuristic while a writer might still exist.
2. For uncertain output, revoke the old device in Komisio. Inspect the physical
   labels, printer buffer and every requested copy. Record the inspection and
   resolve the held database job through the owner/admin recovery controls.
3. Keep all old enrollment, attempt and dispatch evidence. A halted attempt is
   never cleared or rewritten to queued. Use a newly authorized device and a
   fresh enrollment directory after inspection; any necessary print is a new job.
4. A crash lock may be removed only after stopping all writers and reviewing the
   saved checkpoint. A pending/uncertain attempt remains held on restart. Damaged
   credentials, lost keys or uncertain session rotation require reviewed revocation
   and new enrollment, not restoring an old refresh token.
5. To roll back software, stop the service, retain state, restore the previous
   reviewed release symlink/proxy configuration and validate before restarting.
   If state compatibility is uncertain, leave printing disabled. Never roll back
   the database fencing or delete evidence to make the old service run.

Immediately stop the pilot on duplicate output, scope/auth mismatch, unexpected
copies, corrupted state or uncertain physical output. Investigate before any new
job. Uninstalling requires stopping/disabling the unit, revoking its device and
removing the printer's Weblink configuration through its trusted local interface.
Retain inspection/audit evidence; remove only this pilot's host files and DNS
when the operator authorizes teardown.

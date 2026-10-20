# Komisio Print (the local print agent)

Status: delivered with P2 S19 (queue and templates, migration
`20260914080000`), label sizes (`20260916370000`) and the paired device
(`20260916390000`, 2026-09-15). The core keeps a queue of label jobs per
printer; Komisio Print, a small program on the computer next to the
printer, works that queue. Nothing in the hosted application talks to a
printer.

## For the store

Requires Windows 10/11 x64 and a Zebra/ZPL printer connected by network or USB.
USB requires Komisio Print 1.1 or later, the Zebra Windows driver and a local
machine-installed Windows queue on a USBxxx or DOT4_xxx port. The bundled
`KomisioUsb.exe` uses .NET Framework 4.x and Windows RAW spooler calls; it must
stay beside `KomisioPrint.exe`. It never installs drivers or opens file/network
queues. Windows queue acceptance does not prove that a physical label printed.

1. Settings, Printers and labels: download Komisio Print for Windows using
   the button above the tabs. No registered printer is needed to download.
   Unzip to a permanent folder; the Installation tab explains setup.
2. In the Printers tab, select network or USB. For network, enter the address
   (port 9100 if omitted). For USB, run `list-usb-printers.cmd` in the extracted
   folder and enter the exact Windows printer name. Set the model/resolution.
   Open the saved printer
   and press "New pairing code".
3. Run `install.cmd` as administrator and enter the code when asked.
   The code is valid fifteen minutes and works once.
4. Done. Komisio Print runs as a Windows service, starts with the computer
   and prints what the store queues to that printer. Its status (last seen,
   printer reachable, version) shows next to the printer; "Disconnect"
   revokes it at once.

Label sizes and optional custom layouts are in the Labels tab; recent jobs
and linked job recovery are in Print history. Switching tabs retains drafts.

No account, no password, nothing to type but the code. One device per
printer; a second computer gets its own code.

To upgrade an existing installation, extract the complete new package into a
new permanent folder and run `update.cmd` there as administrator. It stops and
reinstalls the service from the new folder while preserving the ProgramData
pairing. Verify version 1.1.0 under the printer before switching it to USB.
The service runs as LocalSystem: user-only shared printer connections are not
supported. Read `README.txt` in the package for error codes and queue checks.
If Windows retains a job while the USB printer is disconnected, inspect that
queue before requesting another copy. Timeouts have an uncertain outcome and
must not be treated as proof that nothing printed.

## Browser item labels

From an accepted item, choose "Print in browser" for an 80 mm label on ordinary
paper. Select 100% scale and disable browser headers and footers. The preview
uses the current item description, price and store currency when opened; reload
it after a price change. This path does not require a paired print agent or queue
a printer job. Physical printer output still needs checking with your hardware.

The I-XXXXXXXX reference works in "Open by label" and the desktop search bar.
It opens an item only in the active store. If two items share the short reference,
Komisio asks you to choose from matching items rather than opening one arbitrarily.
K-n, G-n and H-n references retain their existing drop-off, reception and handover
navigation.

## How it works

- The device signs in as its own anonymous Supabase user and exchanges the
  code (`pair_print_device`) for a membership with the role `device`, bound
  to one printer. A device holds nothing else: it is outside the member
  tenant list, so every row-level policy denies it; it reads its printer
  through `print_device_context`, claims and completes that printer's jobs,
  and reports a heartbeat (`report_print_device`). Codes are stored hashed
  and are never readable. Revocation (`revoke_print_device`) removes the
  membership; the anonymous user is then nothing.
- Anonymous sign-ins must be enabled on the Supabase project (Auth,
  Providers, Anonymous); the local config enables them.
- The program (`print-agent/agent.cjs`) has no dependencies: Node's fetch
  talks to Auth and PostgREST, a TCP socket sends network ZPL and the bundled
  original C# helper sends USB ZPL through OpenPrinter/StartDocPrinter with RAW
  data, WritePrinter and EndDocPrinter. JSON over stdin carries queue names,
  base64 UTF-8 ZPL and copy count; no payload becomes a shell command. Native
  partial writes are completed or failed/aborted, with handles always released. It
  renews its session itself, retries on errors, and exits when revoked (the
  service restarts it after thirty seconds, so a re-pair takes effect).
- The Windows package is built by the `Print agent` workflow: the agent as a
  Node single executable plus the compiled USB helper, with the environment's Supabase URL and
  publishable key baked in (`print-agent/build.mjs`), WinSW 2.12.0 as the
  service wrapper, `install.cmd` and `uninstall.cmd`. A tag `print-v*`
  publishes `KomisioPrint-win-x64.zip` (production) and
  `KomisioPrint-staging-win-x64.zip` (staging) as release assets; Settings
  links to the latest release for its environment. The workflow reads the
  URL and key from the GitHub environments `staging-print` and
  `production-print` (variables `PRINT_SUPABASE_URL`,
  `PRINT_PUBLISHABLE_KEY`; both are public values).
  Tag builds publish staging by default. Once the production project and
  `production-print` variables exist, set the repository variable
  `PRINT_PRODUCTION_ENABLED=true` to also publish the production package.
  Matrix builds run sequentially to avoid racing to create the same release;
  a failed environment does not cancel another. Each executable must pass a
  startup smoke check before packaging.
- Configuration lives in `%ProgramData%\KomisioPrint\device.json` (the
  refresh token, the device and printer ids); logs next to the service
  executable. `KomisioPrint status`, `KomisioPrint unpair`.

Developer path: `node print-agent/agent.cjs pair` and
`node print-agent/agent.cjs run` with `KOMISIO_PRINT_SUPABASE_URL` and
`KOMISIO_PRINT_PUBLISHABLE_KEY` set (a local stack works).
On Windows, run `node print-agent/build-usb.mjs` first for USB support.
`node print-agent/test-usb.mjs` verifies RAW write/failure handling with a fake
spooler and probes the real Windows API without printing. CI runs it on Windows;
transport routing, validation and printer registration also have unit/browser
coverage. USB physical output remains pending a hardware pilot.

## Verification record

| When       | What                                                                                                                                                                                                                              | Result                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 2026-09-15 | Local: anonymous sign-up, pairing code, heartbeat, one job against an unreachable address (`node print-agent/agent.cjs`)                                                                                                          | Paired, heartbeat, job failed as expected |
| 2026-09-15 | Local Windows build of `KomisioPrint.exe` (Node single executable)                                                                                                                                                                | Runs                                      |
| 2026-09-16 | Owner: anonymous sign-ins on staging, GitHub environment `staging-print`, tag `print-v1.0.0`, install.cmd on a computer next to a Zebra ZD420 (203 dpi, 192.168.1.49:9100), pairing code from Settings, label queued from the app | Printed                                   |

## Templates

The manual print route delegates fact loading, rendering and queueing to
`queueRenderedLabel` in `lib/engine/printing.ts`. This is the shared application
render path for the automatic-label follow-up; it still uses the same store
template, kind size, printer resolution, sanitiser and `queue_print_job` command.
The extraction itself does not activate automatic rules or change device access.

Migration `20260916410000` adds the rule storage and engine read/set commands:
one tenant-bound printer and 1–20 copies per kind, configured by owner/admin and
readable by members, never devices. Identical repeated settings do not add audit
events; actual changes do. The reader tolerates a missing RPC during deployment.
This is a storage prerequisite only: no settings switch or event queueing is
enabled yet. The automatic-label identity and producer questions are open
(see open-questions.md); physical automatic printing is not verified.

`zpl-v2` draws the fixed layout scaled to the store's label size at the
printer's resolution (Settings, Printing; defaults 76 x 51 mm for bag and
onboarding labels, 57 x 32 mm for garment, item and markdown labels). Every
dynamic value passes through `zplText`, which removes `^`, `~`, backslashes
and control characters, so a store name or a note can never alter the label
program. The reference is always printed as a Code 128 barcode (bag,
garment, item, markdown) or a QR code (onboarding slip) so scan-to-open
works from the label. The queued job keeps the rendered program, so a later
size change never alters a printed label.

## Store templates (the ZPL editor, 2026-09-15)

Settings, Printing, "Label templates": an owner or admin writes the ZPL
program for a kind with placeholders (`{store}`, `{reference}`, `{line1}`,
`{line2}`, `{price}`, `{oldPrice}`, `{currency}`, `{date}`, `{qr}`,
`{title}`, `{category}`, `{width}`, `{height}` in dots), previews it with
sample data (rendered by Labelary, a public ZPL renderer; no store data is
sent) and saves it as a new version (`label_templates`, migration
`20260916400000`, append-only). The print route fills the current template
with the label's facts through `zplText`, so a value can never carry a
command; the program must be one label (`^XA` ... `^XZ`), must carry
`{reference}`, and may not contain printer control commands (`~`). "Use the
built-in layout" records an inactive version and the scaled layout applies
again. The job's template version reads `store-v<n>`.

## Automatic rule prerequisite deployment

Migration `20260916410000` is additive and leaves existing printing unchanged.
No rule is seeded or activated. The application tolerates only `PGRST202` for
the new read during deployment. Verify the staging migration through GitHub and
the existing manual queue journey; physical printing still needs pilot hardware.
If a regression affects manual printing, revert the application PR through the
normal green-CI path and retain the unused table. Correct database defects with
a successor migration, never by editing an applied migration or deleting audit.

## Printing without Windows (experimental)

This is the #525 spike, not a supported cloud-print release. The store-facing
Windows instructions above remain the supported path. No transport, database
permission, website promise or hosted endpoint is activated by this experiment.
The owner has a ZD420 and iPad for later physical verification. AirPrint,
macOS and Linux arm64 physical checks are follow-ups, not completed tests.

### Recommendation and alternatives

Evaluate direct Weblink first for network Link-OS printers; keep exact-size PDF
as an independent AirPrint path and a small Linux bridge as the inexpensive
network-ZPL fallback. Do not promise iPad-only installation until certificate
loading and URL setup are demonstrated on the actual printer.

| Option | Store equipment and iPad workflow | Cost basis and limitation |
| --- | --- | --- |
| A: own Weblink service | Network Link-OS Zebra; iPad queues through Komisio, printer connects outbound | No extra local computer if the printer is already suitable. Shared hosting and certificate operations; hardware sign-off pending. |
| B: Zebra Cloud Print API | Compatible Zebra enrolled in the store's Nucleus tenant | Per-printer annual Nucleus/API licensing; obtain a vendor quote. An unlicensed tenant has 50 calls/day for testing. |
| C: exact-page PDF / AirPrint | AirPrint label printer such as Brother QL-820NWB; iPad Share → Print | Existing compatible printer: no bridge. Otherwise budget a separate printer and rolls; confirm a current supplier quote before purchase. |
| D: macOS/Linux agent | Existing Mac or network Raspberry Pi; iPad queues through Komisio | Existing computer: no new hardware. Planning allowance EUR 100–180 for a complete Pi kit, not a supplier quote. Physical verification pending. |
| E: Browser Print | Installed Zebra client on Windows/macOS/Android | Existing supported device can be reused; does not solve iPad Safari. |
| F: browser USB/Bluetooth/Serial | Browser-specific hardware APIs | Rejected as the iPad baseline; no supported Safari path has been established. |
| G: native iOS companion | Separate iOS application plus supported network/MFi printer | App distribution and ongoing native maintenance; defer. |
| H: PrintNode | Mac/Linux/Windows/Pi client plus printer; iPad submits remotely | Adds a processor and still needs a local computer. Published free tier: 50 requests/month; Essential EUR 7.20/month for 5,000 requests, subject to current terms. |

The Pi allowance is an engineering budget estimate, excluding printer, media,
electricity and taxes. We have no verified Zebra/Brother purchase quote and no
Cloud Print API licence price. Obtain those before recommending a purchase.

Zebra's current Cloud Print onboarding requires a Nucleus tenant, device
enrolment, both relevant licences and tenant-scoped API tokens. Its documented
commands include print, job status and cancellation. Export the tenant's API
definition before choosing a client protocol. EU-only processing, retention,
subprocessors and pricing were not established by the public guide: obtain a
written answer before selecting this processor. Option A avoids that dependency
but makes Komisio responsible for bridge availability, credentials and upgrades.

### Protocol experiment and verification

Run from the repository root after installing development dependencies:

```bash
npx vitest run tests/unit/weblink-spike.test.ts tests/unit/print-spike-pdf.test.ts tests/unit/print-agent-network.test.ts tests/unit/label-sheets.test.ts
node --import tsx scripts/print-spike/demo.ts
```

`scripts/print-spike/weblink.mjs` starts an ephemeral loopback-only server with
synthetic fixture capabilities. Tests open real local WebSockets using Zebra's
main/raw subprotocols, binary messages and the required zero-length upgrade
header. Discovery requests the raw channel; its initial identity is checked
against the fixture. A `~HS` reply establishes only transport reachability.
Rendered ZPL is transmitted unchanged, once per requested copy. Submitted jobs
are never silently replayed, and channel loss leaves their outcome unknown.

This is not a production authentication or spool implementation. It does not
decode the discovery packet into a trusted identity, establish printer mTLS,
consume real pairing codes, persist sessions, or call Supabase. A serial number
or `unique_id` alone is not proof of printer ownership. The loopback capability
exists only to isolate the synthetic channels. Do not expose this HTTP server
to a LAN, reverse proxy or the internet.

The PDF prototype uses the configured page dimensions, one label per page,
zero PDF page margins, embedded fonts and the existing vector label drawing.
The content stays 57 × 32 mm at 1:1 and is centred on larger media; it is not
stretched to fill the page. Formats smaller than that return
`LABEL_LAYOUT_TOO_SMALL` and need a dedicated readable layout. The 62 mm option
is a 62 × 32 mm cut from continuous media, not an infinite-height page.
Generated examples are in ignored `private/print-spike/`.

Automated checks verify page geometry, copies, input bounds and a real local
TCP listener using the unchanged agent transport. They do not demonstrate
AirPrint scaling, printable hardware margins, a physical barcode scan, or
macOS/Linux arm64 execution. PDF previews must be visually inspected as well.

### Hosted bridge design: not yet deployed

Use a separate persistent service, not a Vercel function. Proposed staging:
Hetzner Cloud CX23, Nuremberg (Germany), 2 vCPU / 4 GB RAM / 40 GB disk.
The published June 2026 price adjustment lists EUR 5.49/month excluding IPv4
and VAT. Budget up to EUR 10/month for the short spike including IPv4;
confirm availability and checkout total before purchase. No server or domain
has been ordered. The owner must approve the issue proposal before deployment.

Use a dedicated non-wildcard name such as `print-spike.z.komisio.com`.
Prefer a publicly trusted SHA-256 certificate with its required trust chain
installed on the printer. Validate TLS 1.2 with modern ciphers against the
actual firmware; the old application note's SHA-1-era advice is superseded by
the current SDK certificate guide. Public certificate renewal should be
automated and monitored; chain changes require a printer rollout check.
Do not disable certificate or hostname verification.

Alternative: Zebra-signed SHA-256 certificate, with a documented 7–10 day
issuance window and three-year renewal deadline. A wildcard requires the
specified `z`, `zebra` or `zserver` name component. This adds operational steps
and is not necessary merely because the printer is a Zebra.

The public SDK example makes client-certificate verification optional.
Do not assume authenticated mTLS is available on the test ZD420: record the
actual certificate and firmware behavior during the handshake. The bridge
design still needs explicit application pairing and authenticated reconnects.

In the real prototype, one printer gets its own existing Supabase anonymous
device identity and refresh token. A single-use fifteen-minute pairing code
selects that device/printer relationship through `pair_print_device`; no
service-role credential, tenant-wide session or expanded RLS is needed.
Validate device context before each claim and heartbeat, and close both
channels immediately on revocation. Keep credentials encrypted outside logs.
Do not log pairing or reconnect capabilities in URLs.

The remaining design gate is authenticated reconnection after the pairing code
has been consumed: verify whether the actual firmware can retain and return a
rotated reconnect capability, or provides a verifiable client certificate.
Do not substitute a serial-number allowlist. Test theft/replay and binding of
the main/raw channels before real queue access.

Start with a bounded three-second queue poll and one in-flight job per device;
push notifications can follow. Reuse claim/complete/report RPCs only with that
device session. Existing stale-claim re-offering after ten minutes is not an
exactly-once guarantee: a durable bridge dispatch journal and explicit
unknown-outcome hold/recovery must prevent an uncertain print being sent twice.
Do not mark physical printing verified merely because a socket write succeeded.
Any `weblink` transport successor migration and durable hold changes belong to
the reviewed implementation follow-up, not this local spike.

Staging isolation: a separate cloud project, synthetic store and device
credentials, no production keys/data, no public administration endpoint.
Restrict management access to the approved operator. Self-hosters need an
equivalent long-lived TLS service and durable encrypted state. On teardown,
revoke the test device, clear its Weblink URL and temporary trust material,
delete the spike host/disk/IPv4, remove DNS, revoke its scoped credentials,
and verify billing has stopped. Preserve only sanitized test results.

### Owner's ZD420 and iPad test script

Do not begin until hosting is approved and the real TLS/pairing adapter is
ready. The loopback experiment above cannot connect a physical printer.
Use a synthetic store/item and record pass/fail plus observations for each
step on #525. Keep tokens, full URLs with capabilities and credentials private.

| Step | Action | Expected result and record |
| --- | --- | --- |
| 1 | Record ZD420 model suffix, firmware, dpi, label size, network option, iPad/iPadOS and available BLE. Save the original printer settings. | Hardware is identified; network Link-OS is available. Do not assume every ZD420 has BLE. |
| 2 | From the iPad, try Printer Setup Utility on a BLE-equipped model. Otherwise open the printer's network administration page in Safari. | Record which path can set Weblink and load the required trust chain. If neither works, stop: iPad-only setup has failed. |
| 3 | Set correct printer time, install the approved trust chain, then set the approved HTTPS Weblink URL, including its required trailing slash. | TLS validates the hostname and chain. Record sanitized firmware/TLS errors; never accept an insecure fallback. |
| 4 | Start pairing from the synthetic store and use its one-time code through the approved secure setup flow. | Device appears bound to exactly that printer/store. Reuse and expired-code attempts fail; no code in logs. |
| 5 | Queue one synthetic item label on the iPad. | Exactly one physical label, correct text/price/reference and readable barcode. Record job ID, photo without personal data and scan result; compare queue/device status. |
| 6 | Request two copies. | Exactly two labels, not two times a conflicting template copy count. Record counts. |
| 7 | Disconnect the printer network while idle, then reconnect. | Reachability becomes false, then true after an authenticated reconnect; no extra label. Record timing. |
| 8 | Power-cycle the printer. | Secure reconnect succeeds without reusing the consumed pairing code. Device remains in the same store. |
| 9 | Interrupt network/power after a job starts; inspect actual output before recovery. | Uncertain outcome is held; no automatic duplicate. Record queue state and actual count. Stop if stale-claim replay prints again. |
| 10 | Revoke the device while connected, then reboot it and queue a test job. | Both channels close; old credentials cannot claim, report or print new work. Record errors and zero new output. |
| 11 | Restore original printer settings and revoke temporary test credentials. | Existing printer setup works again; no residual spike connection. |

Candidate Weblink families include network-equipped ZD420/ZD421/ZD620/ZD621
and supported Link-OS industrial models. This is an evaluation list, not a
Komisio-verified compatibility list. Exclude Link-OS Basic models such as
ZD220/ZD230/ZT111 unless the manufacturer establishes otherwise. Brother
QL-820NWB/QL-1110NWB and Zebra ZSB are separate AirPrint candidates;
Link-OS Weblink support does not imply AirPrint.

### macOS/Linux packaging outline

Keep the existing network agent unchanged initially. Test a platform matrix
on macOS arm64 and Linux arm64 with a fake TCP 9100 listener before packaging;
Windows-only execution of the same code is not proof of those platforms.
Use Node SEA builds on matching target runners, not a renamed Windows binary.
Package `pair`, `status`, `unpair` wrappers with a per-user writable
`~/.komisio-print` directory, private device files and controlled log rotation.
Provide a launchd plist on macOS and a systemd unit on Linux with an
unprivileged dedicated identity, restart policy and network-online ordering.

Sign/notarize the macOS artifact before a public download, verify update
preserves pairing, and test revoke/unpair with the installed service.
Linux arm64 must run on Raspberry Pi OS 64-bit. USB via CUPS is separate:
detect supported raw queues, invoke `lp` with argument arrays/stdin rather
than shell strings, and test uncertain spool acceptance. Do not claim a
current Windows USB helper works on macOS/Linux.

### Sources and follow-up gates

Checked 2026-10-20:

- [Zebra Weblink protocol application note](https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/application-notes/appnotes-creating-weblink-endpoint-rev1-english.pdf), protocol only; use the current TLS guide below.
- [Current Zebra Webservices certificate guidance](https://techdocs.zebra.com/link-os/latest/webservices/).
- [Zebra Cloud Print transition and licensing](https://support.zebra.com/article/000036120).
- [Zebra Browser Print platforms](https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html).
- [WebKit's unsupported hardware APIs](https://webkit.org/tracking-prevention/).
- [Brother QL-820NWB AirPrint manuals](https://support.brother.com/g/b/manualtop.aspx?c=se&lang=sv&pfs=1&prod=lpql820nwbeuk).
- [PrintNode prices](https://www.printnode.com/en/pricing).
- [Hetzner server price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [CX23 specification](https://www.hetzner.com/de/news/new-cloud-plans/).

Follow-ups must separately cover: authenticated hosted Weblink/queue recovery
and device migration; production PDF route and AirPrint hardware calibration
(including small media layouts); macOS/Linux packaging and hardware validation;
all-eight-language printing UI; and website wording only after a supported
path passes its acceptance checks. None is activated by the spike.

Tracked in [#542](https://github.com/Komisio/komisio/issues/542),
[#543](https://github.com/Komisio/komisio/issues/543),
[#544](https://github.com/Komisio/komisio/issues/544) and
[#545](https://github.com/Komisio/komisio/issues/545), respectively.

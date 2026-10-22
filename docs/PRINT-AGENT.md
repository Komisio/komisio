# Komisio Print (the local print agent)

## Weblink dispatch journal (development only)

The owner requested software implementation before the physical printer test
(#542). `scripts/print-bridge/dispatch.mjs` supplies an inactive building block:
it exclusively reserves a job ID and syncs its intent to disk before handing
the original ZPL to a transport. Concurrent processes sharing the directory and
restarted processes refuse an already reserved job. A failed write, torn journal
or incomplete copy sequence cannot trigger an automatic resend. The journal
stores IDs, copy count and a payload digest, never label text or credentials.

`dispatch` requires an authorization adapter that revalidates the device before
reservation and before each copy. A successful transport callback records
`transport_accepted`, not physical printing. An exception leaves
`outcome_unknown`; peer error text is not persisted. `inspect` reads local
evidence and is not a tenant-facing authorization boundary. Neither method
claims jobs, updates Supabase, exposes an endpoint or grants permissions.

Run `npm run test:print-bridge` for the dependency-free process/crash tests.
The Linux service requires a private directory owned by its service user on a
local persistent filesystem. Its parent must already exist. All bridge workers
must share that directory; NFS, ephemeral storage and separate replicas are not
supported. Linux syncs the file and directory before transport. Windows runs
development tests only; it does not establish Linux filesystem durability.

Do not delete, prune or restore journal files to retry work. Missing restored
evidence could allow duplicate output. Hosted activation still requires reviewed
queue fencing/recovery, authenticated printer main/raw channels and reconnects,
device-scoped queue integration, and physical TLS/copy/revocation tests. The
database's existing stale-claim handling and the Windows agent are unchanged.
This component alone does not make Weblink printing available in Komisio.

## Existing Windows agent

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

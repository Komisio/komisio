# Komisio Print (the local print agent)

Status: delivered with P2 S19 (queue and templates, migration
`20260914080000`), label sizes (`20260916370000`) and the paired device
(`20260916390000`, 2026-09-15). The core keeps a queue of label jobs per
printer; Komisio Print, a small program on the computer next to the
printer, works that queue. Nothing in the hosted application talks to a
printer.

## For the store

1. Settings, Printing: register the printer (name, IP address with port
   9100, model, resolution) and set the label sizes.
2. Download Komisio Print for Windows (the link is next to the printer),
   unzip, run `install.cmd` as administrator.
3. Press "New pairing code" next to the printer and enter it when the
   installer asks. The code is valid fifteen minutes and works once.
4. Done. Komisio Print runs as a Windows service, starts with the computer
   and prints what the store queues to that printer. Its status (last seen,
   printer reachable, version) shows next to the printer; "Disconnect"
   revokes it at once.

No account, no password, nothing to type but the code. One device per
printer; a second computer gets its own code.

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
  talks to Auth and PostgREST, a TCP socket sends ZPL to the printer. It
  renews its session itself, retries on errors, and exits when revoked (the
  service restarts it after thirty seconds, so a re-pair takes effect).
- The Windows package is built by the `Print agent` workflow: the agent as a
  Node single executable with the environment's Supabase URL and
  publishable key baked in (`print-agent/build.mjs`), WinSW 2.12.0 as the
  service wrapper, `install.cmd` and `uninstall.cmd`. A tag `print-v*`
  publishes `KomisioPrint-win-x64.zip` (production) and
  `KomisioPrint-staging-win-x64.zip` (staging) as release assets; Settings
  links to the latest release for its environment. The workflow reads the
  URL and key from the GitHub environments `staging-print` and
  `production-print` (variables `PRINT_SUPABASE_URL`,
  `PRINT_PUBLISHABLE_KEY`; both are public values).
- Configuration lives in `%ProgramData%\KomisioPrint\device.json` (the
  refresh token, the device and printer ids); logs next to the service
  executable. `KomisioPrint status`, `KomisioPrint unpair`.

Developer path: `node print-agent/agent.cjs pair` and
`node print-agent/agent.cjs run` with `KOMISIO_PRINT_SUPABASE_URL` and
`KOMISIO_PRINT_PUBLISHABLE_KEY` set (a local stack works).

## Templates

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

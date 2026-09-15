# Local print agent

Status: delivered with P2 S19 (migration `20260914080000`). The core keeps a
queue of label jobs per printer; a small Node script next to the printer works
that queue. Nothing in the hosted application talks to a printer.

## How it works

1. An owner or admin registers the printer in Settings (name, TCP address or
   USB, model, dpi). Printers are never deleted; inactive printers accept no
   jobs.
2. Staff press "Send to printer" on a bag label, a garment label, an item or a
   seller page. The application renders the ZPL program from a versioned
   template (`lib/labels/templates.ts`) and calls `queue_print_job`, which
   binds the job to the printer and to the referenced fact.
3. The agent, signed in as a dedicated staff member of the store, calls
   `claim_print_job` for its printer, sends the program over TCP once per
   copy, and calls `complete_print_job` with the outcome. A claim older than
   ten minutes is handed out again so a crashed agent loses nothing.
4. Settings show the recent jobs with their status and error text.

## Running the agent

```
KOMISIO_PRINT_SUPABASE_URL=https://<project>.supabase.co \
KOMISIO_PRINT_PUBLISHABLE_KEY=<publishable key> \
KOMISIO_PRINT_ACCESS_TOKEN=<access token of the printer's staff account> \
KOMISIO_PRINT_TENANT_ID=<tenant id> \
KOMISIO_PRINT_PRINTER_ID=<printer id> \
node scripts/print-agent.mjs
```

The account needs the `staff` role in that store and MFA enrolled like any
member. Use a separate account per printer so the audit trail names the
device. The agent supports the `tcp` transport (port 9100 by default); USB
and a signed executable are later work.

## Templates

`zpl-v2` draws the same layout as `zpl-v1` scaled to the store's label size at the printer's resolution. The size per label kind is set under Settings, Printing (width and height in millimetres; defaults 76 x 51 mm for bag and onboarding labels, 57 x 32 mm for garment, item and markdown labels; migration `20260916370000`). The queued job keeps the rendered program, so a later size change never alters a printed label. The reference layout is 58 x 40 mm at 203 dpi. Every dynamic value passes through
`zplText`, which removes `^`, `~`, backslashes and control characters, so a
store name or a note can never alter the label program. The reference is
always printed as a Code 128 barcode (bag, garment, item, markdown) or a QR
code (onboarding slip) so scan-to-open works from the label.

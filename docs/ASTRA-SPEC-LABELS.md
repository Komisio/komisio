# Spec for Astra: label configuration, step 2

Owner request 2026-09-15: make label configuration complete for a store,
building on what Fable delivered the same day. Read this whole file, then
[PRINT-AGENT.md](PRINT-AGENT.md) (how printing works end to end) before
writing code. Architectural questions go to Fable and the owner; do not
replace the direction silently.

## What exists (do not rebuild)

| Piece                                                 | Where                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Print queue, claim/complete, printers                 | migration `20260914080000`, `lib/engine/printing.ts`, `app/api/print/route.ts`           |
| Label sizes per kind (mm), scaled built-in layout     | `20260916370000`, `lib/labels/templates.ts` (`zpl-v2`, `renderLabel`)                    |
| Paired print devices (Komisio Print, Windows service) | `20260916390000`, `print-agent/`, `lib/engine/print-devices.ts`                          |
| Store ZPL templates per kind, versions, preview       | `20260916400000`, `lib/labels/placeholders.ts`, `components/intake/label-templates-form` |
| Placeholders and the sanitiser                        | `placeholders` in `lib/labels/placeholders.ts`, `zplText` in `lib/labels/templates.ts`   |

Invariants that stay: every dynamic value passes through `zplText`; a
template is one label (`^XA`…`^XZ`) carrying `{reference}`; no `~` printer
control commands; versions are append-only (`komisio_private.preserve_shopify`
trigger reused as "immutable"); the queued job keeps the rendered program
and its template version; devices see nothing but their printer.

## Scope of step 2 (in this order)

### 1. Automatic printing per event (the legacy "AutomaticOnSave")

A store chooses, per label kind, whether a label is queued automatically
when its fact is created, and to which printer.

- Table `label_print_rules(tenant_id, kind, printer_id, copies, enabled,
updated_by, updated_at, pk(tenant_id, kind))`, RLS read for members,
  writes through `set_label_print_rule(p_tenant, p_kind, p_printer, p_copies,
p_enabled)` (owner/admin) and a read `label_print_rules(p_tenant)`.
- Events that fire: `bag` on bag receipt, `garment` on garment receipt,
  `item` on acceptance (including `quick_receive`), `onboarding` on seller
  registration, `markdown` on a markdown price change. Fire from the
  application side, not from SQL triggers: the render needs the store's
  format, template and printer dpi, which live in the application render
  path. Add a small engine helper `queueLabelFor(client, tenantId, kind,
referenceId)` in `lib/engine/printing.ts` that reads the rule and, when
  enabled, does what `app/api/print/route.ts` does today (extract that
  route's render-and-queue body into the helper and call it from both).
- Idempotency: the job id derives from `md5('auto:' || kind || ':' ||
reference id)` shaped with `komisio_private.derived_uuid`, so a retried
  event never queues twice; `queue_print_job` already replays by id.
- Settings, Printing: a "Print automatically" table (kind, printer,
  copies, on/off) under the sizes. Quick reception keeps its printer
  choice as an override; when a rule exists the quick screen preselects
  that printer.

### 2. Test print

A button per kind in the template editor and in the sizes table: queues
the label rendered with `sampleFacts(kind)` to a chosen printer. Needs a
reference row today (`queue_print_job` validates `reference_kind`/`id`):
add `reference_kind = 'sample'` with a null reference id to the check in a
new migration (re-declare `queue_print_job`; keep every other rule). The
job's `label_kind` stays the real kind so the device prints it like any
other.

### 3. Several templates per kind and printer binding

Today one active template per kind. Stores with two printers (a wide one
for bags at the counter, a small one for garments) want a template per
printer.

- Extend `label_templates` with `printer_id uuid null` (null = every
  printer). Resolution order in the render helper: template for (kind,
  printer) → template for (kind, null) → built-in layout. `label_templates(p_tenant)`
  returns both levels; the editor gets a printer selector ("all printers"
  or one).
- Versions stay per (kind, printer): unique `(tenant_id, kind, printer_id,
version)` with `printer_id` coalesced to a fixed uuid in a unique index.

### 4. Guided editor (no ZPL knowledge needed)

A form that produces the ZPL for people who will not write it:

- Elements: store name, title (line1), second line (line2), price, old
  price, reference barcode (Code 128) or QR, date, free text. Each with
  position (mm from left/top), font height (mm), and for barcodes a
  height. The form renders to ZPL with the existing primitives (`^FO`,
  `^A0N`, `^BCN`, `^BQN`) at the label's dpi, always with `{placeholders}`,
  never with values, and saves through the same `set_label_template` so
  versions, preview and the guards are unchanged.
- Store the element list alongside the ZPL: add `design jsonb null` to
  `label_templates` (validated shape, max 40 elements) so the guided
  editor can reopen its own template; a template written by hand has
  `design null` and opens in the text editor.
- Preview reuses `/api/print/preview`.

### 5. Import and export

"Copy ZPL" and "Paste ZPL" are enough: the text editor already is the
import path. Export = the textarea. No file formats.

## Guardrails and tests

- pgTAP for every migration (rules, sample reference, printer-bound
  templates, design shape): owner/admin writes, staff read, other stores
  refused, immutability, replay.
- Unit tests for the guided editor's ZPL output (positions in dots for
  203/300 dpi, placeholders only, sanitiser untouched) and for the
  automatic queueing helper (rule off = nothing, rule on = one job, retry
  = same job).
- One e2e journey: enable a rule for `item`, run quick reception, see the
  job in Settings, Printing.
- No new dependencies. No changes to the device role, `verified_session`
  or `user_tenant_ids`. Labelary stays the only external call and gets
  sample data only.
- Migration timestamps: take the next free `202609164xxxxx` after the
  newest on main; check Fable's worktree branch list first.

## Owner decisions already taken

Custom ZPL per store is allowed (DECISIONS 2026-09-15, label templates).
Defaults for sizes are 76 x 51 mm (bag, onboarding) and 57 x 32 mm
(garment, item, markdown). One device per printer.

## Owner answers (2026-09-15)

1. The size stays per kind; a printer-bound template does not override
   it. The template may still set its own `^PW`/`^LL` from `{width}` and
   `{height}`, which are the kind's size at that printer's resolution.
2. The automatic rule for `item` fires on every acceptance, including the
   acceptance in the target store of a chain transfer (the target store's
   rule and printer).

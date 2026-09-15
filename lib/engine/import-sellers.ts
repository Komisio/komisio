import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { proposeOperation } from './operations'

// Import wizard, first slice: sellers from the store's previous system. The
// file is parsed in the browser with the small parser below, the person maps
// the columns and reads the preview, and one staged operation carries the
// rows. Approval registers them through the ordinary seller command; nothing
// is written by the upload itself. No AI is involved yet: the header guess is
// a fixed list of names.
export const importRow = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254).default(''),
  phone: z.string().trim().max(40).default(''),
})
export const importSellersPayload = z.strictObject({
  source: z.string().trim().min(1).max(200),
  rows: z.array(importRow).min(1).max(200),
})
export type ImportSellersPayload = z.infer<typeof importSellersPayload>

/** A small RFC 4180 parser: comma or semicolon (detected on the first line), quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '')
  const firstLine = body.split(/\r?\n/, 1)[0] ?? ''
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ','
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((v) => v.trim() !== '')) rows.push(row)
  return rows
}

export type ColumnMapping = {
  name: number | null
  email: number | null
  phone: number | null
}
const headerNames: Record<keyof ColumnMapping, string[]> = {
  name: [
    'name',
    'namn',
    'seller',
    'säljare',
    'inlämnare',
    'consignor',
    'kund',
    'customer',
    'fullname',
    'full name',
  ],
  email: ['email', 'e-mail', 'e-post', 'epost', 'mail', 'mejl'],
  phone: [
    'phone',
    'telefon',
    'tel',
    'mobil',
    'mobile',
    'telefonnummer',
    'phone number',
  ],
}

/** Guess which column holds what from the header row; the person can override. */
export function guessMapping(header: string[]): ColumnMapping {
  const cells = header.map((h) => h.trim().toLowerCase())
  const find = (key: keyof ColumnMapping) => {
    const i = cells.findIndex((c) => headerNames[key].includes(c))
    if (i >= 0) return i
    const j = cells.findIndex((c) =>
      headerNames[key].some((n) => c.includes(n)),
    )
    return j >= 0 ? j : null
  }
  return { name: find('name'), email: find('email'), phone: find('phone') }
}

/** Rows under a mapping, with the reason each unusable row is left out. */
export function mapRows(
  rows: string[][],
  mapping: ColumnMapping,
  skipHeader: boolean,
) {
  const accepted: ImportSellersPayload['rows'] = []
  const rejected: { line: number; reason: 'name' | 'contact' | 'email' }[] = []
  rows.forEach((cells, index) => {
    if (skipHeader && index === 0) return
    const pick = (i: number | null) =>
      i === null ? '' : (cells[i] ?? '').trim()
    const row = {
      name: pick(mapping.name),
      email: pick(mapping.email).toLowerCase(),
      phone: pick(mapping.phone),
    }
    if (!row.name) return rejected.push({ line: index + 1, reason: 'name' })
    if (!row.email && !row.phone)
      return rejected.push({ line: index + 1, reason: 'contact' })
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
      return rejected.push({ line: index + 1, reason: 'email' })
    const parsed = importRow.safeParse(row)
    if (!parsed.success)
      return rejected.push({ line: index + 1, reason: 'name' })
    accepted.push(parsed.data)
  })
  return { accepted, rejected }
}

export const stageImportCommand = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  expiresAt: z.iso.datetime(),
  payload: importSellersPayload,
})

/** Stages the import as one low-risk operation; the queue is where it is approved. */
export async function stageSellerImport(
  client: SupabaseClient,
  input: unknown,
) {
  const c = stageImportCommand.parse(input)
  return proposeOperation(client, {
    tenantId: c.tenantId,
    requestId: c.requestId,
    actorLabel: 'import-wizard',
    expiresAt: c.expiresAt,
    kind: 'importSellers',
    payload: c.payload,
  })
}

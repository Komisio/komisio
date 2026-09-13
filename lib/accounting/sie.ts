import { z } from 'zod'

// SIE 4 export (P2 S17): one voucher per day close, rendered from the lines
// SQL recorded under the tenant's own account map. Komisio proposes no
// accounts and no postings; it only formats what the store's accountant set.
// PC8 is declared as SIE readers expect, so text is reduced to ASCII.
export const voucherLine = z.strictObject({
  key: z.string().min(1).max(60),
  account: z.string().regex(/^[1-9]\d{3}$/),
  side: z.enum(['debit', 'credit']),
  amountOre: z.union([z.number().int(), z.string()]).transform(Number),
})
export type VoucherLine = z.infer<typeof voucherLine>
export const sieVoucherInput = z.strictObject({
  storeName: z.string().trim().min(1).max(120),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closeVersion: z.number().int().positive(),
  generatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(voucherLine).min(1).max(100),
})

const fold: Record<string, string> = {
  å: 'a',
  ä: 'a',
  ö: 'o',
  Å: 'A',
  Ä: 'A',
  Ö: 'O',
  é: 'e',
  É: 'E',
  ü: 'u',
  Ü: 'U',
}
/** Quoted SIE text: ASCII only, no quotes, no control characters, one line. */
export function sieText(input: string) {
  return `"${input
    .replace(/[åäöÅÄÖéÉüÜ]/g, (c) => fold[c] ?? c)
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/"/g, '')
    .trim()
    .slice(0, 100)}"`
}
const yyyymmdd = (iso: string) => iso.replace(/-/g, '')
/** Öre as SIE amount text: debit positive, credit negative, two decimals. */
export function sieAmount(amountOre: number, side: 'debit' | 'credit') {
  const abs = Math.abs(Math.trunc(amountOre))
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  return side === 'credit' && abs > 0 ? `-${text}` : text
}

/** Renders one SIE 4 file with a single voucher in series A. */
export function renderSie4(input: unknown) {
  const v = sieVoucherInput.parse(input)
  const debit = v.lines
    .filter((l) => l.side === 'debit')
    .reduce((s, l) => s + l.amountOre, 0)
  const credit = v.lines
    .filter((l) => l.side === 'credit')
    .reduce((s, l) => s + l.amountOre, 0)
  if (debit !== credit) throw new Error('VOUCHER_UNBALANCED')
  const rows = [
    '#FLAGGA 0',
    '#FORMAT PC8',
    '#SIETYP 4',
    `#PROGRAM ${sieText('Komisio')} ${sieText('1')}`,
    `#GEN ${yyyymmdd(v.generatedOn)}`,
    `#FNAMN ${sieText(v.storeName)}`,
    `#VER "A" "" ${yyyymmdd(v.closeDate)} ${sieText(`Dagsavslut ${v.closeDate} v${v.closeVersion}`)}`,
    '{',
    ...v.lines.map(
      (l) => `#TRANS ${l.account} {} ${sieAmount(l.amountOre, l.side)}`,
    ),
    '}',
  ]
  return rows.join('\r\n') + '\r\n'
}

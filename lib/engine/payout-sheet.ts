/** A read-only snapshot, never a bank instruction or payment confirmation. */
export type PaymentSheet = {
  store: string
  generatedAt: string
  page: number
  currency: string
  rows: { id: string; seller: string; amountOre: number }[]
}

function cell(value: string) {
  // Quoting alone does not prevent spreadsheet formula execution.
  const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function paymentSheetCsv(sheet: PaymentSheet, headings: string[]) {
  const rows = sheet.rows.map((row) => {
    if (!Number.isSafeInteger(row.amountOre) || row.amountOre <= 0)
      throw new Error('Invalid payout amount')
    const ore = BigInt(row.amountOre)
    return [
      sheet.store,
      sheet.generatedAt,
      String(sheet.page),
      row.id,
      row.seller,
      `${ore / 100n}.${String(ore % 100n).padStart(2, '0')}`,
      sheet.currency,
    ]
  })
  return (
    '\uFEFF' +
    [headings, ...rows].map((row) => row.map(cell).join(';')).join('\r\n') +
    '\r\n'
  )
}

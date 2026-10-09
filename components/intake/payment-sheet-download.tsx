'use client'
import { Button } from '@/components/ui/button'
import { paymentSheetCsv, type PaymentSheet } from '@/lib/engine/payout-sheet'

export function PaymentSheetDownload({
  sheet,
  headings,
  label,
}: {
  sheet: PaymentSheet
  headings: string[]
  label: string
}) {
  return (
    <Button
      variant="secondary"
      onClick={() => {
        const url = URL.createObjectURL(
          new Blob([paymentSheetCsv(sheet, headings)], {
            type: 'text/csv;charset=utf-8',
          }),
        )
        const link = document.createElement('a')
        link.href = url
        link.download = `komisio-payments-${sheet.generatedAt.slice(0, 10)}-p${sheet.page}.csv`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}
    >
      {label}
    </Button>
  )
}

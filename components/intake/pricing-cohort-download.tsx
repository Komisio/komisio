'use client'
import { Button } from '@/components/ui/button'
import type { PricingFollowUp } from '@/lib/engine/pricing-follow-up'

/** Download the exact displayed snapshot, with no names, descriptions or photos. */
export function PricingCohortDownload({
  cohort,
  label,
  date,
}: {
  cohort: NonNullable<PricingFollowUp['cohort']>
  label: string
  date: string
}) {
  return (
    <Button
      variant="secondary"
      onClick={() => {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(cohort)], { type: 'application/json' }),
        )
        const link = document.createElement('a')
        link.href = url
        link.download = `komisio-pricing-${date}.json`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}
    >
      {label}
    </Button>
  )
}

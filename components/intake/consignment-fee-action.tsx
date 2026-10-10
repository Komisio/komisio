'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { useIntakeAction } from './use-intake-action'
import { ReloadAction } from './reload-action'
import { Button } from '@/components/ui/button'

export function ConsignmentFeeAction({
  tenantId,
  feeId,
  sellerId,
  operation,
  d,
}: {
  tenantId: string
  feeId?: string
  sellerId?: string
  operation: 'pay' | 'reverse' | 'accrue'
  d: Dictionary
}) {
  const action = useIntakeAction(d.intake),
    router = useRouter()
  const [saved, setSaved] = useState(false)
  const t = d.consignmentFees
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const command =
          operation === 'accrue'
            ? { action: 'accrueSellerConsignmentFees', sellerId }
            : operation === 'pay'
              ? {
                  action: 'recordConsignmentFeePayment',
                  feeId,
                  reference: f.get('evidence'),
                }
              : {
                  action: 'reverseConsignmentFee',
                  feeId,
                  reason: f.get('evidence'),
                }
        if (
          await action.run(
            action.locked
              ? {}
              : { ...command, tenantId, requestId: crypto.randomUUID() },
          )
        ) {
          setSaved(true)
          router.refresh()
        }
      }}
    >
      <fieldset
        className="intake-fields"
        disabled={action.busy || action.locked || action.needsReload || saved}
      >
        {operation !== 'accrue' && (
          <label>
            {operation === 'pay' ? t.reference : t.reason}
            <input
              name="evidence"
              required
              maxLength={operation === 'pay' ? 200 : 500}
            />
          </label>
        )}
        {operation !== 'accrue' && (
          <label className="intake-confirm">
            <input type="checkbox" required />
            {operation === 'pay' ? t.confirmPayment : t.confirmReversal}
          </label>
        )}
      </fieldset>
      <Button
        type="submit"
        variant="secondary"
        disabled={action.busy || action.needsReload || saved}
      >
        {action.busy
          ? d.intake.busy
          : action.locked
            ? d.intake.retry
            : t[operation]}
      </Button>
      {action.error && <p role="alert">{action.error}</p>}
      {saved && <p role="status">{t.saved}</p>}
      {action.needsReload && <ReloadAction label={d.intake.reload} />}
    </form>
  )
}

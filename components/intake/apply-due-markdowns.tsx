'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** Apply every due markdown step in the store as one recorded run. */
export function ApplyDueMarkdowns({
  tenantId,
  dueCount,
  d,
  intake,
}: {
  tenantId: string
  dueCount: number
  d: Dictionary['lifecycle']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [requestId] = useState(() => crypto.randomUUID())
  const [done, setDone] = useState(false)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (
          await action.run({ action: 'applyDueMarkdowns', tenantId, requestId })
        ) {
          setDone(true)
          router.refresh()
        }
      }}
    >
      {action.error && <p role="alert">{action.error}</p>}
      {!done && (
        <Button
          type="submit"
          disabled={action.busy || action.needsReload || dueCount === 0}
        >
          {action.busy
            ? intake.busy
            : d.applyAllDue.replace('{count}', String(dueCount))}
        </Button>
      )}
      {done && <p role="status">{d.applied}</p>}
    </form>
  )
}

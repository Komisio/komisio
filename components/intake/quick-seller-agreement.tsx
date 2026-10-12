'use client'
import { useStartWork } from '@/components/platform/work-activity'
import { useEffect, useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useIntakeAction } from './use-intake-action'
import {
  SellerAgreementFields,
  approvalFromFields,
  type AgreementSummary,
} from './seller-agreement-fields'

type Snapshot = { agreement: AgreementSummary | null; accepted: boolean }
export function QuickSellerAgreement({
  tenantId,
  sellerId,
  d,
  intake,
  quick,
  onGuardChange,
  onReload,
}: {
  tenantId: string
  sellerId: string
  d: Dictionary['agreements']
  intake: Dictionary['intake']
  quick: Dictionary['quickIntake']
  onReload: () => void
  onGuardChange: (state: { dirty: boolean; locked: boolean }) => void
}) {
  const startWork = useStartWork()
  const [result, setResult] = useState<Snapshot | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const finish = startWork()
    fetch(
      `/api/sellers/${sellerId}/agreement?tenant=${encodeURIComponent(tenantId)}`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('READ_FAILED')
        const data: Snapshot = await response.json()
        if (!controller.signal.aborted) {
          setResult(data)
          setFailed(false)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
      .finally(finish)
    return () => {
      controller.abort()
      finish()
    }
  }, [tenantId, sellerId, retry, startWork])
  if (!result)
    return (
      <div role={failed ? 'alert' : 'status'}>
        <p>
          {failed
            ? quick.workspace.agreementFailed
            : quick.workspace.loadingAgreement}
        </p>
        {failed && (
          <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
            {intake.retry}
          </Button>
        )}
      </div>
    )
  return (
    <ApprovalForm
      key={result.agreement?.id ?? 'none'}
      tenantId={tenantId}
      sellerId={sellerId}
      snapshot={result}
      d={d}
      intake={intake}
      quick={quick}
      onGuardChange={onGuardChange}
      onReload={onReload}
    />
  )
}
function ApprovalForm({
  tenantId,
  sellerId,
  snapshot,
  d,
  intake,
  quick,
  onGuardChange,
  onReload,
}: {
  tenantId: string
  sellerId: string
  snapshot: Snapshot
  d: Dictionary['agreements']
  intake: Dictionary['intake']
  quick: Dictionary['quickIntake']
  onReload: () => void
  onGuardChange: (state: { dirty: boolean; locked: boolean }) => void
}) {
  const action = useIntakeAction(intake)
  const [saved, setSaved] = useState(false)
  const [missing, setMissing] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const summary = useRef<HTMLElement>(null)
  const { dirty, checkDirty } = useFormDirty(form)
  useUnsavedChanges(
    !saved && (dirty || action.locked) ? quick.workspace.leaveSeller : null,
  )
  useEffect(() => {
    onGuardChange({
      dirty: !saved && dirty,
      locked: !saved && (action.busy || action.locked),
    })
  }, [saved, dirty, action.busy, action.locked, onGuardChange])
  if (!snapshot.agreement) return null
  return (
    <details
      id="quick-agreement"
      className="quick-agreement"
      open={!snapshot.accepted && !saved}
    >
      <summary ref={summary}>
        {quick.workspace.agreement}{' '}
        <span
          className={
            snapshot.accepted || saved
              ? 'quick-agreement-approved'
              : 'quick-agreement-pending'
          }
        >
          {snapshot.accepted || saved
            ? quick.workspace.agreementAccepted
            : quick.workspace.agreementPending}
        </span>
      </summary>
      <form
        ref={form}
        onChange={checkDirty}
        onSubmit={async (event) => {
          event.preventDefault()
          const approval = approvalFromFields(new FormData(event.currentTarget))
          if (!approval && !action.locked) {
            setMissing(true)
            return
          }
          setMissing(false)
          const id = await action.run(
            action.locked
              ? {}
              : {
                  action: 'recordEvidence',
                  tenantId,
                  sellerId,
                  requestId: crypto.randomUUID(),
                  ...approval,
                },
          )
          if (id) {
            setSaved(true)
            requestAnimationFrame(() => summary.current?.focus())
          }
        }}
      >
        <fieldset
          className="intake-fields"
          disabled={action.busy || action.locked || action.needsReload}
        >
          <SellerAgreementFields
            saveWithSeller={false}
            tenantId={tenantId}
            sellerId={sellerId}
            agreement={snapshot.agreement}
            accepted={snapshot.accepted || saved}
            d={d}
          />
        </fieldset>
        {missing && <p role="alert">{d.confirmEvidence}</p>}
        {action.error && <p role="alert">{action.error}</p>}
        {snapshot.agreement && !snapshot.accepted && !saved && (
          <Button type="submit" disabled={action.busy || action.needsReload}>
            {action.busy
              ? intake.busy
              : action.locked
                ? intake.retry
                : d.record}
          </Button>
        )}
        {action.needsReload && (
          <Button type="button" variant="secondary" onClick={onReload}>
            {quick.workspace.refreshAgreement}
          </Button>
        )}
        {saved && <p role="status">{d.recorded}</p>}
      </form>
    </details>
  )
}

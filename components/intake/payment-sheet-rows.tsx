'use client'
import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { Button } from '@/components/ui/button'
import { useIntakeAction } from './use-intake-action'
import { PayoutDecision } from './payout-forms'
import { ReloadAction } from './reload-action'

type Row = { id: string; seller: string; amountOre: number }

/** Staff records transfers already made; this form never sends money. */
export function PaymentSheetRows({
  tenantId,
  currency,
  rows,
  editable,
  d,
  payouts,
  intake,
}: {
  tenantId: string
  currency: string
  rows: Row[]
  editable: boolean
  d: Dictionary['payoutSheet']
  payouts: Dictionary['payouts']
  intake: Dictionary['intake']
}) {
  const formId = useId()
  const router = useRouter()
  const action = useIntakeAction(intake)
  const [selected, setSelected] = useState<string[]>([])
  const [references, setReferences] = useState<Record<string, string>>({})
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState(false)
  const [snapshot, setSnapshot] = useState<{
    rows: Row[]
    selected: string[]
    references: Record<string, string>
  } | null>(null)
  const pending = action.locked ? snapshot : null
  const visibleRows = pending?.rows ?? rows
  const chosenIds = pending?.selected ?? selected
  const visibleReferences = pending?.references ?? references
  const chosen = visibleRows.filter((row) => chosenIds.includes(row.id))
  const total = chosen.reduce((sum, row) => sum + row.amountOre, 0)
  if (!Number.isSafeInteger(total)) throw new Error('Invalid payout total')
  const frozen = action.busy || action.locked || action.needsReload
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    if (!action.locked) setSnapshot({ rows, selected, references })
    const savedId = await action.run({
      action: 'confirmPayoutPayments',
      tenantId,
      requestId,
      currency,
      payments: chosen.map((row) => ({
        payoutId: row.id,
        amountOre: row.amountOre,
        reference: visibleReferences[row.id] ?? '',
      })),
    })
    if (savedId) {
      setSelected([])
      setReferences({})
      setSnapshot(null)
      setRequestId(crypto.randomUUID())
      setSaved(true)
      router.refresh()
    }
  }
  return (
    <div>
      {editable && rows.length > 1 && (
        <label className="payment-sheet-select-all no-print">
          <input
            type="checkbox"
            disabled={frozen}
            checked={chosen.length === visibleRows.length}
            onChange={(event) => {
              setSelected(event.target.checked ? rows.map((row) => row.id) : [])
              setSaved(false)
            }}
          />
          {d.selectAll}
        </label>
      )}
      <fieldset
        className="payment-sheet-rows"
        disabled={frozen}
        aria-label={d.title}
      >
        {visibleRows.map((row) => {
          const checked = chosenIds.includes(row.id)
          return (
            <section
              key={row.id}
              className="payment-sheet-row"
              data-payout={row.id}
            >
              <div className="payment-sheet-summary">
                <div className="payment-sheet-payee">
                  {editable && (
                    <input
                      type="checkbox"
                      className="no-print"
                      aria-label={d.select
                        .replace('{seller}', row.seller)
                        .replace(
                          '{amount}',
                          `${formatSignedOre(row.amountOre)} ${currency}`,
                        )}
                      checked={checked}
                      onChange={(event) => {
                        setSelected(
                          event.target.checked
                            ? [...selected, row.id]
                            : selected.filter((id) => id !== row.id),
                        )
                        setSaved(false)
                      }}
                    />
                  )}
                  <strong>{row.seller}</strong>
                </div>
                <strong>
                  {formatSignedOre(row.amountOre)} {currency}
                </strong>
              </div>
              <p className="payment-sheet-reference">
                {d.reference}: {row.id}
              </p>
              {editable && checked ? (
                <div className="field no-print">
                  <label htmlFor={`${formId}-${row.id}`}>
                    {payouts.reference}
                  </label>
                  <input
                    id={`${formId}-${row.id}`}
                    form={formId}
                    required
                    maxLength={200}
                    value={visibleReferences[row.id] ?? ''}
                    onChange={(event) =>
                      setReferences({
                        ...references,
                        [row.id]: event.target.value,
                      })
                    }
                  />
                </div>
              ) : editable ? (
                <details className="no-print">
                  <summary>{d.individual}</summary>
                  <PayoutDecision
                    tenantId={tenantId}
                    payoutId={row.id}
                    status="approved"
                    d={payouts}
                    intake={intake}
                  />
                </details>
              ) : null}
            </section>
          )
        })}
      </fieldset>
      {editable && chosen.length > 0 && (
        <form
          id={formId}
          onSubmit={submit}
          className="payment-sheet-confirmation no-print"
        >
          <p role="status">
            <strong>
              {d.selected.replace('{count}', String(chosen.length))} ·{' '}
              {formatSignedOre(total)} {currency}
            </strong>
          </p>
          {action.error && <p role="alert">{action.error}</p>}
          {action.needsReload ? (
            <ReloadAction label={intake.reload} />
          ) : (
            <Button type="submit" disabled={action.busy}>
              {action.busy
                ? intake.busy
                : action.locked
                  ? intake.retry
                  : d.confirmSelected}
            </Button>
          )}
        </form>
      )}
      {saved && (
        <p role="status" className="no-print">
          {d.confirmed}
        </p>
      )}
    </div>
  )
}

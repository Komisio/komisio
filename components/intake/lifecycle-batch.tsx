'use client'
import { PriceReason } from './price-reason'
import { useEffect, useId, useRef, useState } from 'react'
import type { Dictionary, Locale } from '@/lib/i18n'
import { intlLocale } from '@/lib/i18n'
import {
  lifecycleBatchCommand,
  lifecycleBatchPreview,
  lifecycleBatchResult,
  type LifecycleBatchCommand,
  type LifecycleBatchPreview,
  type LifecycleBatchResult,
} from '@/lib/engine/item-lifecycle-batch'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { useInventorySelection } from './inventory-selection'
import { useRouter } from '@/components/platform/use-working-router'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useBusyState } from '@/components/platform/work-activity'

export function LifecycleBatch({
  tenantId,
  currency,
  locale,
  d,
}: {
  tenantId: string
  currency: string
  locale: Locale
  d: Dictionary
}) {
  const { selected, ids } = useInventorySelection()
  const [items, setItems] = useState<string[] | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const chosen = selected.filter((id) => ids.includes(id))
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="btn btn-secondary"
        disabled={!chosen.length}
        onClick={() => setItems([...chosen])}
      >
        {d.itemLifecycleBatch.title}
      </button>
      {items && (
        <BatchDialog
          {...{ tenantId, currency, locale, d, items }}
          close={() => {
            setItems(null)
            trigger.current?.focus()
          }}
        />
      )}
    </>
  )
}

function BatchDialog({
  tenantId,
  currency,
  locale,
  d,
  items,
  close,
}: {
  tenantId: string
  currency: string
  locale: Locale
  d: Dictionary
  items: string[]
  close: () => void
}) {
  const t = d.itemLifecycleBatch,
    l = d.lifecycle,
    dialog = useRef<HTMLDialogElement>(null),
    id = useId(),
    router = useRouter()
  const [kind, setKind] = useState('end'),
    [preview, setPreview] = useState<LifecycleBatchPreview | null>(null),
    [result, setResult] = useState<LifecycleBatchResult | null>(null)
  const [busy, setBusy] = useBusyState(false),
    [uncertain, setUncertain] = useState(false),
    [refused, setRefused] = useState(false),
    [error, setError] = useState('')
  const pending = useRef<Extract<
      LifecycleBatchCommand,
      { action: 'apply' }
    > | null>(null),
    running = useRef(false)
  const dates = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeZone: 'Europe/Stockholm',
  })
  useUnsavedChanges(uncertain ? d.leaveUnsaved : null, 'inventory-table')
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  async function send(command: LifecycleBatchCommand) {
    if (running.current || refused) return
    running.current = true
    setBusy(true)
    setError('')
    if (command.action === 'apply') setUncertain(true)
    try {
      const response = await fetch('/api/items/lifecycle-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const body = await response.json()
      if (!response.ok || body.ok !== true) {
        if (response.status >= 400 && response.status < 500) {
          setRefused(true)
          setUncertain(false)
          setError(d.itemWorkflow.changed)
        } else
          setError(
            command.action === 'apply'
              ? d.itemWorkflow.uncertain
              : t.previewFailed,
          )
        return
      }
      if (command.action === 'preview') {
        const p = lifecycleBatchPreview.parse(body.result)
        if (
          p.length !== items.length ||
          p.some((row, i) => row.itemId !== items[i])
        )
          throw Error('INVALID_RESPONSE')
        pending.current = {
          action: 'apply',
          tenantId,
          requestId: crypto.randomUUID(),
          operation: command.operation,
          preview: p,
        }
        setPreview(p)
      } else {
        const r = lifecycleBatchResult.parse(body.result)
        if (
          r.id !== command.requestId ||
          r.items.length !== command.preview.length ||
          r.items.some((row, i) => row.itemId !== command.preview[i].itemId)
        )
          throw Error('INVALID_RESPONSE')
        setResult(r)
        pending.current = null
        setUncertain(false)
      }
    } catch {
      setError(
        command.action === 'apply' ? d.itemWorkflow.uncertain : t.previewFailed,
      )
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  function prepare(form: HTMLFormElement) {
    const f = new FormData(form),
      reason = String(f.get('reason') ?? '').trim(),
      value = String(f.get('price') ?? '')
        .trim()
        .replace(',', '.')
    const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value)
    const operation =
      kind === 'end'
        ? { kind, endAction: String(f.get('endAction')), reason }
        : kind === 'extend'
          ? { kind, days: Number(f.get('days')), reason }
          : kind === 'setPrice'
            ? {
                kind,
                priceOre: match
                  ? Number(match[1]) * 100 +
                    Number((match[2] ?? '').padEnd(2, '0'))
                  : null,
                reason,
              }
            : { kind }
    const c = lifecycleBatchCommand.safeParse({
      action: 'preview',
      tenantId,
      items,
      operation,
    })
    if (!c.success) {
      setError(t.previewFailed)
      return
    }
    void send(c.data)
  }
  function finishClose() {
    if (result) router.refresh()
    close()
  }
  return (
    <dialog
      ref={dialog}
      className="inventory-batch-dialog"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy && !uncertain) finishClose()
      }}
    >
      <div className="inventory-batch-heading">
        <h2 id={id}>{t.title}</h2>
        <button
          type="button"
          disabled={busy || uncertain}
          onClick={finishClose}
        >
          {d.printing.close}
        </button>
      </div>
      <p>{t.hint}</p>
      {!result && (
        <form
          className="intake-fields"
          onSubmit={(e) => {
            e.preventDefault()
            prepare(e.currentTarget)
          }}
        >
          <fieldset disabled={busy || refused || preview !== null}>
            <div className="field">
              <label htmlFor={`${id}-operation`}>
                {d.itemPeriod.operation}
              </label>
              <select
                id={`${id}-operation`}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="end">{l.end}</option>
                <option value="extend">{l.extend}</option>
                <option value="setPrice">{l.setPrice}</option>
                <option value="markdown">{t.markdown}</option>
              </select>
            </div>
            {kind === 'end' && (
              <div className="field">
                <label htmlFor={`${id}-end`}>{l.endAction}</label>
                <select id={`${id}-end`} name="endAction" defaultValue="return">
                  {(['return', 'charity', 'recycle'] as const).map((a) => (
                    <option key={a} value={a}>
                      {l[a]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {kind === 'extend' && (
              <div className="field">
                <label htmlFor={`${id}-days`}>{l.days}</label>
                <input
                  id={`${id}-days`}
                  name="days"
                  type="number"
                  min="1"
                  max="365"
                  step="1"
                  required
                />
              </div>
            )}
            {kind === 'setPrice' && (
              <div className="field">
                <label htmlFor={`${id}-price`}>
                  {l.price} ({currency})
                </label>
                <input
                  id={`${id}-price`}
                  name="price"
                  inputMode="decimal"
                  maxLength={12}
                  required
                />
              </div>
            )}
            {kind === 'setPrice' && <PriceReason d={d.priceEdit} />}
            {kind !== 'markdown' && kind !== 'setPrice' && (
              <div className="field">
                <label htmlFor={`${id}-reason`}>
                  {kind === 'end' ? l.note : l.reason}
                </label>
                <input
                  id={`${id}-reason`}
                  name="reason"
                  maxLength={500}
                  required={kind !== 'end'}
                />
              </div>
            )}
            {!preview && (
              <button type="submit" className="btn">
                {busy ? d.intake.busy : t.preview}
              </button>
            )}
          </fieldset>
        </form>
      )}
      {preview && (
        <>
          <h3>{result ? t.results : t.preview}</h3>
          <ul className="lifecycle-batch-preview">
            {preview.map((row, i) => {
              const outcome = result?.items[i]
              const reason = outcome?.reason ?? row.reason
              return (
                <li key={row.itemId}>
                  <strong>{row.title || d.items.item}</strong>{' '}
                  <small>I-{row.itemId.slice(0, 8).toUpperCase()}</small>
                  <p>
                    {outcome?.status === 'applied'
                      ? t.applied
                      : reason
                        ? `${t.skipped}: ${t.reasons[reason]}`
                        : t.ready}
                  </p>
                  {row.eligible &&
                    (!result || outcome?.status === 'applied') && (
                      <p>
                        {row.priceOre !== null &&
                          `${formatSignedOre(row.priceOre)} ${currency}`}
                        {row.periodEnd &&
                          ` · ${l.periodEnd}: ${dates.format(new Date(row.periodEnd))}`}
                      </p>
                    )}
                </li>
              )
            })}
          </ul>
          {!result && !refused && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (pending.current) void send(pending.current)
              }}
            >
              {kind === 'end' && (
                <label className="intake-confirm">
                  <input
                    type="checkbox"
                    required
                    disabled={busy || uncertain}
                  />
                  {l.endConfirm}
                </label>
              )}
              <button
                type="submit"
                className="btn"
                disabled={busy || !preview.some((row) => row.eligible)}
              >
                {busy ? d.intake.busy : uncertain ? d.intake.retry : t.apply}
              </button>
              <button
                type="button"
                disabled={busy || uncertain}
                onClick={() => {
                  setPreview(null)
                  pending.current = null
                  setError('')
                }}
              >
                {t.back}
              </button>
            </form>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          {t.results}:{' '}
          {result.items.filter((r) => r.status === 'applied').length}{' '}
          {t.applied},{' '}
          {result.items.filter((r) => r.status === 'skipped').length}{' '}
          {t.skipped}
        </p>
      )}
      {refused && (
        <button type="button" onClick={() => window.location.reload()}>
          {d.intake.reload}
        </button>
      )}
    </dialog>
  )
}

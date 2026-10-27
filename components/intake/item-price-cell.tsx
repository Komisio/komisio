'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pencil } from 'lucide-react'
import { useRouter } from '@/components/platform/use-working-router'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import type { Dictionary, Locale } from '@/lib/i18n'
import { economyFormat } from '@/lib/intake/economy-format'
import { formatOre } from '@/lib/engine/items'
import { setItemPriceCommand } from '@/lib/engine/lifecycle'
import { useIntakeAction } from './use-intake-action'
import { PriceReason } from './price-reason'

const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

export function ItemPriceCell({
  tenantId,
  itemId,
  priceOre,
  currency,
  locale,
  title,
  write,
  d,
}: {
  tenantId: string
  itemId: string
  priceOre: string | null
  currency: string
  locale: Locale
  title: string
  write: boolean
  d: Dictionary
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{
    base: string
    value: string
  } | null>(null)
  const current = confirmed?.base === priceOre ? confirmed.value : priceOre
  const button = useRef<HTMLButtonElement>(null)
  const display =
    current === null
      ? '—'
      : economyFormat(locale).money(Number(current), currency)
  function close() {
    setEditing(null)
    requestAnimationFrame(() => button.current?.focus())
  }
  return (
    <>
      {write && current !== null ? (
        <button
          type="button"
          ref={button}
          disabled={!ready}
          className="inventory-cell-button inventory-price-editor"
          aria-label={`${d.priceEdit.title}: ${title}`}
          onClick={() => setEditing(current)}
        >
          <span className="inventory-price-value">{display}</span>
          <Pencil size={12} aria-hidden="true" />
        </button>
      ) : (
        <span className="inventory-price-value">{display}</span>
      )}
      {confirmed && (
        <span role="status" className="sr-only">
          {d.priceEdit.saved}
        </span>
      )}
      {editing !== null && (
        <PriceDialog
          tenantId={tenantId}
          itemId={itemId}
          expected={editing}
          currency={currency}
          title={title}
          d={d}
          close={close}
          saved={(value) => {
            setConfirmed({ base: priceOre!, value })
            close()
          }}
        />
      )}
    </>
  )
}
function PriceDialog({
  tenantId,
  itemId,
  expected,
  currency,
  title,
  d,
  close,
  saved,
}: {
  tenantId: string
  itemId: string
  expected: string
  currency: string
  title: string
  d: Dictionary
  close: () => void
  saved: (value: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null),
    form = useRef<HTMLFormElement>(null)
  const action = useIntakeAction(d.intake),
    router = useRouter()
  const [price, setPrice] = useState(formatOre(expected)),
    [invalid, setInvalid] = useState(false),
    [dirty, setDirty] = useState(false)
  const blocked = action.busy || action.locked || action.needsReload
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  useUnsavedChanges(
    dirty || action.locked ? d.leaveUnsaved : null,
    'inventory-table',
  )
  async function save() {
    if (action.busy || action.needsReload) return
    const value = price.trim().replace(',', '.')
    const parts = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value)
    const ore = parts
      ? Number(
          BigInt(parts[1]) * 100n + BigInt((parts[2] ?? '').padEnd(2, '0')),
        )
      : 0
    const data = setItemPriceCommand.safeParse({
      action: 'setItemPrice',
      tenantId,
      itemId,
      requestId: crypto.randomUUID(),
      priceOre: ore,
      expectedPriceOre: Number(expected),
      reason: String(new FormData(form.current!).get('reason') ?? ''),
    })
    if (!data.success) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (await action.run(data.data)) {
      saved(String(ore))
      router.refresh()
    }
  }
  return (
    <dialog
      ref={ref}
      className="inventory-price-dialog"
      aria-labelledby={`price-title-${itemId}`}
      onCancel={(e) => {
        e.preventDefault()
        if (!blocked) close()
      }}
    >
      <h2 id={`price-title-${itemId}`}>{d.priceEdit.title}</h2>
      <p>{title}</p>
      <form
        ref={form}
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={blocked}>
          <label htmlFor={`price-input-${itemId}`}>
            {d.lifecycle.price} ({currency})
          </label>
          <input
            id={`price-input-${itemId}`}
            autoFocus
            inputMode="decimal"
            maxLength={12}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
          <PriceReason d={d.priceEdit} />
        </fieldset>
        {invalid && <p role="alert">{d.intake.invalid}</p>}
        {action.error && <p role="alert">{action.error}</p>}
        <div className="row wrap">
          {!action.locked && !action.needsReload && (
            <button className="btn" type="submit" disabled={action.busy}>
              {d.itemWorkflow.save}
            </button>
          )}
          {action.locked && !action.busy && !action.needsReload && (
            <button className="btn" type="button" onClick={() => void save()}>
              {d.intake.retry}
            </button>
          )}
          {action.needsReload && (
            <button
              className="btn"
              type="button"
              onClick={() => window.location.reload()}
            >
              {d.intake.reload}
            </button>
          )}
          <button
            className="btn btn-secondary"
            type="button"
            disabled={blocked}
            onClick={close}
          >
            {d.cancel}
          </button>
        </div>
      </form>
    </dialog>
  )
}

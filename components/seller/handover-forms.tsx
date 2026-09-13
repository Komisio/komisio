'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import type { MyHandovers } from '@/lib/engine/handovers'

/** Announce a bag or box and follow it until the store has received it. */
export function SellerHandovers({
  tenantId,
  sellerId,
  handovers,
  d,
}: {
  tenantId: string
  sellerId: string
  handovers: MyHandovers
  d: Dictionary['sellerPortal']
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const retry = useRef<{ key: string; id: string } | null>(null)
  async function submit(payload: object) {
    setBusy(true)
    setNotice('')
    const key = JSON.stringify(payload)
    const id =
      retry.current?.key === key ? retry.current.id : crypto.randomUUID()
    retry.current = { key, id }
    try {
      const r = await fetch('/api/seller/handovers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, sellerId, requestId: id, ...payload }),
      })
      if (!r.ok) throw new Error()
      retry.current = null
      setNotice(d.saved)
      router.refresh()
    } catch {
      setNotice(d.error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form" aria-label={d.handovers}>
      <h2>{d.handovers}</h2>
      <p>{d.handoverIntro}</p>
      {handovers.enabled ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            void submit({
              action: 'createHandover',
              kind: String(f.get('kind')),
              estimatedItems: Number(f.get('estimatedItems') || 0),
              note: String(f.get('note') ?? ''),
            })
          }}
        >
          <fieldset className="intake-fields" disabled={busy}>
            <div className="field">
              <label htmlFor="handover-kind">{d.handoverKind}</label>
              <select id="handover-kind" name="kind" defaultValue="bag">
                <option value="bag">{d.handoverKinds.bag}</option>
                <option value="box">{d.handoverKinds.box}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="handover-items">{d.estimatedItems}</label>
              <input
                id="handover-items"
                name="estimatedItems"
                type="number"
                min={0}
                max={500}
                defaultValue={5}
              />
            </div>
            <div className="field">
              <label htmlFor="handover-note">{d.handoverNote}</label>
              <input id="handover-note" name="note" maxLength={500} />
            </div>
          </fieldset>
          <Button type="submit" disabled={busy}>
            {d.announce}
          </Button>
        </form>
      ) : (
        <p>{d.handoverDisabled}</p>
      )}
      {handovers.handovers.length === 0 && <p>{d.none}</p>}
      {handovers.handovers.map((h) => (
        <div key={h.id} className="intake-notice">
          <strong style={{ fontSize: '1.4em' }}>{h.reference}</strong>
          <p>
            {d.handoverKinds[h.kind]} · {h.estimatedItems} ·{' '}
            {d.handoverStatuses[h.status]}
            {h.bagReference ? ` · ${h.bagReference}` : ''}
            {h.note ? ` · ${h.note}` : ''}
          </p>
          {h.status === 'open' && (
            <>
              <p>{d.showReference}</p>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void submit({ action: 'cancelHandover', handoverId: h.id })
                }
              >
                {d.cancelHandover}
              </Button>
            </>
          )}
        </div>
      ))}
      <p role="status">{notice}</p>
    </section>
  )
}

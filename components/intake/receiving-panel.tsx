'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Dictionary } from '@/lib/i18n'
import type { Seller } from '@/lib/engine/intake'
import { intakeCommand } from '@/lib/engine/intake'
import { Button } from '@/components/ui/button'

export function ReceivingPanel({
  tenantId,
  seller,
  d,
}: {
  tenantId: string
  seller: Seller | null
  d: Dictionary['intake']
}) {
  const router = useRouter()
  const pending = useRef<Record<string, unknown> | null>(null)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bagId, setBagId] = useState('')
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const command =
      pending.current ??
      (seller
        ? {
            action: 'receiveBag',
            tenantId,
            requestId: crypto.randomUUID(),
            sellerId: seller.id,
            note: String(fields.get('note') ?? '').trim(),
          }
        : {
            action: 'registerSeller',
            tenantId,
            requestId: crypto.randomUUID(),
            name: String(fields.get('name') ?? '').trim(),
            email: String(fields.get('email') ?? '').trim(),
            phone: String(fields.get('phone') ?? '').trim(),
          })
    if (!seller && !command.email && !command.phone) {
      setError(d.contactHint)
      return
    }
    if (!intakeCommand.safeParse(command).success) {
      setError(d.invalid)
      return
    }
    pending.current = command
    setLocked(true)
    setBusy(true)
    setError('')
    setBagId('')
    try {
      const response = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const result = await response.json()
      if (!response.ok) {
        if (result.error === 'INVALID_INPUT') {
          pending.current = null
          setLocked(false)
          setError(d.invalid)
          return
        }
        setError(
          result.error === 'TENANT_CHANGED'
            ? d.changed
            : ['FORBIDDEN', 'AUTH_REQUIRED'].includes(result.error)
              ? d.denied
              : d.failed,
        )
        return
      }
      pending.current = null
      setLocked(false)
      form.reset()
      if (seller) setBagId(result.id)
      else router.push(`/intake?seller=${result.id}`)
      router.refresh()
    } catch {
      setError(d.failed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form">
      <h2>{seller ? d.receive : d.newSeller}</h2>
      {seller && (
        <p>
          <strong>{seller.name}</strong>
          <br />
          {seller.email || seller.phone}
        </p>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={busy || locked} className="intake-fields">
          {seller ? (
            <>
              <div className="field">
                <label htmlFor="bag-note">{d.note}</label>
                <input
                  id="bag-note"
                  name="note"
                  maxLength={500}
                  aria-describedby="bag-note-hint"
                />
                <small id="bag-note-hint">{d.noteHint}</small>
              </div>
              <label className="intake-confirm">
                <input type="checkbox" required />
                {d.custody}
              </label>
            </>
          ) : (
            <>
              <p id="seller-contact-hint">{d.contactHint}</p>
              <div className="field">
                <label htmlFor="seller-name">{d.name}</label>
                <input id="seller-name" name="name" required maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="seller-email">{d.email}</label>
                <input
                  id="seller-email"
                  name="email"
                  type="email"
                  maxLength={254}
                  aria-describedby="seller-contact-hint"
                />
              </div>
              <div className="field">
                <label htmlFor="seller-phone">{d.phone}</label>
                <input
                  id="seller-phone"
                  name="phone"
                  type="tel"
                  maxLength={40}
                  aria-describedby="seller-contact-hint"
                />
              </div>
            </>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? d.busy : locked ? d.retry : seller ? d.saveBag : d.saveSeller}
        </Button>
      </form>
      {bagId && (
        <div role="status" className="intake-success">
          <p>{d.saved}</p>
          <Link className="text-link" href={`/intake/bags/${bagId}`}>
            {d.label}
          </Link>
        </div>
      )}
    </section>
  )
}

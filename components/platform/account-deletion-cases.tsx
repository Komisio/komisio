'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { DeletionCase } from '@/lib/engine/account-deletion'
import { accountDeletionCopy } from '@/lib/platform/account-deletion-copy'
import type { Locale } from '@/lib/i18n'
import styles from './account-deletion-cases.module.css'

export function AccountDeletionCases({
  rows,
  locale,
}: {
  rows: DeletionCase[]
  locale: Locale
}) {
  const d = accountDeletionCopy(locale)
  return rows.length ? (
    <div className="grid gap-4">
      {rows.map((row) => (
        <Case key={`${row.id}:${row.revision}`} row={row} locale={locale} />
      ))}
    </div>
  ) : (
    <p>{d.empty}</p>
  )
}
function Case({ row, locale }: { row: DeletionCase; locale: Locale }) {
  const d = accountDeletionCopy(locale)
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const lock = useRef(false)
  const [personal, setPersonal] = useState(false)
  const [external, setExternal] = useState(false)
  const [confirmation, setConfirmation] = useState(false)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [apple, setApple] = useState(row.appleLinked ? '' : 'not_applicable')
  const systemReady = Object.values(row.checks).every(Boolean)
  async function act(kind: 'processing' | 'completed') {
    if (lock.current || uncertain) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/host/account-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          requestId: row.id,
          expected: row.revision,
          kind,
          evidence:
            kind === 'processing'
              ? {}
              : {
                  personalDataReviewed: personal,
                  externalCopiesReviewed: external,
                  confirmationSent: confirmation,
                  retentionReason: reason,
                  confirmationReference: reference,
                  appleHandling: apple,
                },
        }),
      })
      const body = await response.json()
      if (
        !response.ok ||
        body.request?.id !== row.id ||
        body.request?.status !== kind
      ) {
        setError(body.error === 'DELETION_INCOMPLETE' ? d.incomplete : d.failed)
        setUncertain(true)
        return
      }
      setUncertain(true)
      router.refresh()
    } catch {
      setError(d.failed)
      setUncertain(true)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <section className={`card intake-form ${styles.case}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>{row.email || row.phone || row.userId}</h2>
        <strong>{d[row.status]}</strong>
      </div>
      <p>
        {d.due}:{' '}
        {new Intl.DateTimeFormat(locale === 'dk' ? 'da' : locale, {
          dateStyle: 'medium',
        }).format(new Date(row.respondBy))}
      </p>
      <details>
        <summary>
          {d.stores} ({row.stores.length})
        </summary>
        <ul>
          {row.stores.map((s) => (
            <li key={s.sellerId}>
              {s.name} · {d.items}: {s.openItems}
              {s.balanceUnsettled ? ` · ${d.balance}` : ''} ·{' '}
              {s.closed ? d.sellerContactsClosed : d.review}
              <small className="block break-all">{s.sellerId}</small>
            </li>
          ))}
        </ul>
      </details>
      <p>
        {d.requests}: {row.externalRequests} · {d.photos}: {row.externalPhotos}
      </p>
      {row.status === 'requested' ? (
        <Button
          disabled={busy || uncertain}
          onClick={() => void act('processing')}
        >
          {d.start}
        </Button>
      ) : null}
      {row.status === 'processing' ? (
        <>
          <h3>{d.checks}</h3>
          <ul className={styles.checks}>
            {Object.entries(row.checks).map(([key, done]) => (
              <li key={key}>
                {done ? '✓' : '○'} {d[key as keyof DeletionCase['checks']]}
              </li>
            ))}
          </ul>
          <p>{d.notice}</p>
          <form
            className={`intake-fields ${styles.form}`}
            onSubmit={(e) => {
              e.preventDefault()
              void act('completed')
            }}
          >
            <fieldset disabled={busy || uncertain}>
              <legend>{d.complete}</legend>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={personal}
                  onChange={(e) => setPersonal(e.target.checked)}
                />
                {d.personal}
              </label>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={external}
                  onChange={(e) => setExternal(e.target.checked)}
                />
                {d.external}
              </label>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={confirmation}
                  onChange={(e) => setConfirmation(e.target.checked)}
                />
                {d.confirmation}
              </label>
              <label className="field">
                {d.apple}
                <select
                  value={apple}
                  onChange={(e) => setApple(e.target.value)}
                >
                  <option value="">—</option>
                  <option value="revoked">{d.revoked}</option>
                  <option value="manual_instructions">{d.manual}</option>
                  {!row.appleLinked ? (
                    <option value="not_applicable">{d.notApplicable}</option>
                  ) : null}
                </select>
              </label>
              <label className="field">
                {d.reason}
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  maxLength={2000}
                  required
                />
              </label>
              <label className="field">
                {d.reference}
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  minLength={3}
                  maxLength={200}
                  required
                />
              </label>
              <Button
                type="submit"
                disabled={
                  !systemReady ||
                  !personal ||
                  !external ||
                  !confirmation ||
                  !apple ||
                  reason.trim().length < 10 ||
                  reference.trim().length < 3
                }
              >
                {d.complete}
              </Button>
            </fieldset>
          </form>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {uncertain ? (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {d.refresh}
        </Button>
      ) : null}
    </section>
  )
}

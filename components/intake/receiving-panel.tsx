'use client'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Dictionary } from '@/lib/i18n'
import type { Seller } from '@/lib/engine/intake'
import type { SellerMatches } from '@/lib/engine/sellers'
import { intakeCommand } from '@/lib/engine/intake'
import { Button } from '@/components/ui/button'

export function ReceivingPanel({
  tenantId,
  seller,
  d,
  details,
  changeSellerLabel,
  expectedAgreementId = null,
  agreementBlocked = false,
}: {
  tenantId: string
  seller: Seller | null
  d: Dictionary['intake']
  details: Dictionary['sellerDetails']
  changeSellerLabel: string
  expectedAgreementId?: string | null
  agreementBlocked?: boolean
}) {
  const router = useRouter()
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focusName = () => {
      if (!seller && window.location.hash === '#new-seller')
        nameInput.current?.focus()
    }
    focusName()
    window.addEventListener('hashchange', focusName)
    return () => window.removeEventListener('hashchange', focusName)
  }, [seller])
  const pending = useRef<Record<string, unknown> | null>(null)
  // A later refusal cannot settle an earlier request whose reply was lost.
  const uncertain = useRef(false)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bagId, setBagId] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  // Sellers already registered with the typed details; null until checked.
  const [matches, setMatches] = useState<SellerMatches['matches'] | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || needsReload || (agreementBlocked && !pending.current)) return
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
            expectedAgreementId,
          }
        : {
            action: 'registerSeller',
            tenantId,
            requestId: crypto.randomUUID(),
            name: String(fields.get('name') ?? '').trim(),
            email: String(fields.get('email') ?? '').trim(),
            phone: String(fields.get('phone') ?? '').trim(),
            details: Object.fromEntries(
              [
                'nationalId',
                'addressLine1',
                'addressLine2',
                'postalCode',
                'city',
                'country',
              ].map((key) => [key, String(fields.get(key) ?? '').trim()]),
            ),
          })
    if (!seller && !command.email && !command.phone) {
      setError(d.contactHint)
      return
    }
    if (!intakeCommand.safeParse(command).success) {
      setError(d.invalid)
      return
    }
    if (command.action === 'registerSeller' && matches === null) {
      // Advisory check first; a failed check does not stop the registration.
      setBusy(true)
      try {
        const q = new URLSearchParams({
          name: String(command.name),
          email: String(command.email),
          phone: String(command.phone),
        })
        const r = await fetch(`/api/sellers/matches?${q}`)
        const found: SellerMatches['matches'] = r.ok
          ? ((await r.json()).matches ?? [])
          : []
        setMatches(found)
        if (found.length > 0) {
          setError('')
          return
        }
      } catch {
        setMatches([])
      } finally {
        setBusy(false)
      }
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
        if (
          uncertain.current ||
          response.status < 400 ||
          response.status >= 500
        ) {
          uncertain.current = true
          setError(d.failed)
          return
        }
        if (result.error === 'AGREEMENT_CHANGED') {
          pending.current = null
          setLocked(false)
          setNeedsReload(true)
          setError(d.agreementChanged)
          return
        }
        if (result.error === 'AGREEMENT_REQUIRED') {
          pending.current = null
          setLocked(false)
          setError(d.agreementRequired)
          router.refresh()
          return
        }
        if (result.error === 'INVALID_INPUT') {
          pending.current = null
          setLocked(false)
          setError(d.invalid)
          return
        }
        uncertain.current = true
        setError(
          result.error === 'TENANT_CHANGED'
            ? d.changed
            : ['FORBIDDEN', 'AUTH_REQUIRED'].includes(result.error)
              ? d.denied
              : d.failed,
        )
        return
      }
      // Both commands return their request id. Missing or unrelated success
      // data is not confirmation: retain the exact command for a safe replay.
      if (result?.ok !== true || result.id !== command.requestId)
        throw new Error('UNCONFIRMED_RECEIPT')
      pending.current = null
      uncertain.current = false
      setLocked(false)
      setMatches(null)
      form.reset()
      if (seller) setBagId(result.id)
      else router.push(`/intake?seller=${result.id}#new-seller`)
      router.refresh()
    } catch {
      uncertain.current = true
      setError(d.failed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form receiving-panel">
      {seller ? (
        <FormHelpHeading title={d.receive} help={d.formHelp} />
      ) : (
        <h2>{d.newSeller}</h2>
      )}
      {seller && (
        <div className="receiving-seller-context">
          <div>
            <strong>{seller.name}</strong>
            <br />
            {seller.email || seller.phone}
          </div>
          <Link className="btn btn-secondary" href="/intake#seller-search">
            {changeSellerLabel}
          </Link>
        </div>
      )}
      <form onSubmit={submit}>
        <fieldset
          disabled={busy || locked}
          className="intake-fields"
          onChange={() => {
            if (!seller && !pending.current) setMatches(null)
          }}
        >
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
                <input
                  ref={nameInput}
                  id="seller-name"
                  name="name"
                  required
                  maxLength={120}
                />
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
              <details className="seller-disclosure">
                <summary>{details.moreFields}</summary>
                <div className="seller-disclosure-body">
                  {(
                    [
                      ['nationalId', details.nationalId, 40],
                      ['addressLine1', details.street, 160],
                      ['addressLine2', details.addressExtra, 160],
                      ['postalCode', details.postalCode, 24],
                      ['city', details.city, 120],
                      ['country', details.country, 80],
                    ] as const
                  ).map(([key, label, maxLength]) => (
                    <div className="field" key={key}>
                      <label htmlFor={`new-seller-${key}`}>{label}</label>
                      <input
                        id={`new-seller-${key}`}
                        name={key}
                        maxLength={maxLength}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {!seller && matches && matches.length > 0 && (
          <div role="alert" className="intake-matches">
            <p>{d.possibleDuplicates}</p>
            <ul>
              {matches.map((m) => (
                <li key={m.id}>
                  <Link
                    className="text-link"
                    href={`/intake?seller=${m.id}#new-seller`}
                  >
                    {m.name}
                  </Link>{' '}
                  {m.contact}{' '}
                  <small>
                    (
                    {m.reasons
                      .map((r) =>
                        r === 'email'
                          ? d.matchEmail
                          : r === 'phone'
                            ? d.matchPhone
                            : d.matchName,
                      )
                      .join(', ')}
                    )
                  </small>
                </li>
              ))}
            </ul>
          </div>
        )}
        {seller && agreementBlocked && <p>{d.agreementRequired}</p>}
        {needsReload && (
          <a
            className="text-link"
            href={`/intake?seller=${seller?.id ?? ''}#new-seller`}
          >
            {d.reload}
          </a>
        )}
        <Button
          type="submit"
          disabled={busy || needsReload || (agreementBlocked && !locked)}
        >
          {busy
            ? d.busy
            : locked
              ? d.retry
              : seller
                ? d.saveBag
                : matches && matches.length > 0
                  ? d.registerAnyway
                  : d.saveSeller}
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

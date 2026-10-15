'use client'
import { useRef, useState } from 'react'
import { useBusyState } from '@/components/platform/work-activity'
import { useRouter } from '@/components/platform/use-working-router'
import {
  bankCommand,
  type BankVersion,
  type PayoutBank,
} from '@/lib/engine/seller-bank'
import { storeCountries } from '@/lib/platform/countries'
import { intlLocale, type Dictionary, type Locale } from '@/lib/i18n'

function useBankSave(d: Dictionary) {
  const router = useRouter(),
    [busy, setBusy] = useBusyState(false),
    [locked, setLocked] = useState(false),
    [refused, setRefused] = useState(false),
    [message, setMessage] = useState('')
  const pending = useRef<ReturnType<typeof bankCommand.parse> | null>(null),
    running = useRef(false)
  async function save(input: unknown) {
    if (running.current || refused) return
    const parsed = bankCommand.safeParse(pending.current ?? input)
    if (!parsed.success) {
      setMessage(d.sellerBank.invalid)
      return
    }
    pending.current = parsed.data
    running.current = true
    setBusy(true)
    setLocked(true)
    setMessage('')
    try {
      const r = await fetch('/api/seller/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = await r.json()
      if (r.ok && body.ok === true && body.id === parsed.data.requestId) {
        pending.current = null
        setLocked(false)
        setMessage(d.itemWorkflow.saved)
        router.refresh()
      } else if (r.status >= 400 && r.status < 500) {
        setRefused(true)
        setMessage(d.itemWorkflow.changed)
      } else setMessage(d.itemWorkflow.uncertain)
    } catch {
      setMessage(d.itemWorkflow.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { busy, locked, refused, message, save }
}
export function SellerBankEditor({
  tenantId,
  sellerId,
  current,
  locale,
  d,
}: {
  tenantId: string
  sellerId: string
  current: BankVersion | null
  locale: Locale
  d: Dictionary
}) {
  const t = d.sellerBank,
    state = useBankSave(d),
    [kind, setKind] = useState<'iban' | 'local'>(
      current?.details.kind ?? 'iban',
    )
  const names = new Intl.DisplayNames([intlLocale(locale)], { type: 'region' })
  const countries = storeCountries
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, intlLocale(locale)))
  return (
    <details className="card" id="portal-bank">
      <summary>{t.title}</summary>
      <p>{t.privacy}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const account = String(f.get('account') ?? '')
          void state.save({
            action: 'save',
            tenantId,
            sellerId,
            requestId: crypto.randomUUID(),
            expected: current?.id ?? null,
            details: {
              holder: String(f.get('holder') ?? ''),
              country: String(f.get('country') ?? ''),
              kind,
              account:
                kind === 'iban'
                  ? account.replace(/\s/g, '').toUpperCase()
                  : account,
              routing: kind === 'iban' ? '' : String(f.get('routing') ?? ''),
            },
          })
        }}
      >
        <fieldset disabled={state.locked || state.busy} className="form-grid">
          <label>
            {t.holder}
            <input
              name="holder"
              required
              maxLength={160}
              defaultValue={current?.details.holder ?? ''}
              autoComplete="off"
            />
          </label>
          <label>
            {t.country}
            <select
              name="country"
              aria-label={t.country}
              required
              defaultValue={current?.details.country ?? ''}
            >
              <option value="">{d.itemWorkflow.choose}</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.kind}
            <select
              value={kind}
              aria-label={t.kind}
              onChange={(e) => setKind(e.target.value as 'iban' | 'local')}
            >
              <option value="iban">IBAN</option>
              <option value="local">{t.local}</option>
            </select>
          </label>
          <label>
            {kind === 'iban' ? 'IBAN' : t.account}
            <input
              name="account"
              required
              maxLength={100}
              defaultValue={current?.details.account ?? ''}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {kind === 'local' && (
            <label>
              {t.routing}
              <input
                name="routing"
                maxLength={100}
                defaultValue={current?.details.routing ?? ''}
                autoComplete="off"
              />
            </label>
          )}
        </fieldset>
        <button className="btn" disabled={state.busy || state.refused}>
          {d.itemWorkflow.save}
        </button>
        {state.message && <p role="status">{state.message}</p>}
        {state.refused && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.location.reload()}
          >
            {d.itemWorkflow.reload}
          </button>
        )}
      </form>
    </details>
  )
}
export function SellerBankAccount({
  bank,
  d,
}: {
  bank: BankVersion
  d: Dictionary
}) {
  return (
    <dl>
      <dt>{d.sellerBank.holder}</dt>
      <dd>{bank.details.holder}</dd>
      <dt>{d.sellerBank.country}</dt>
      <dd>{bank.details.country}</dd>
      <dt>{bank.details.kind === 'iban' ? 'IBAN' : d.sellerBank.account}</dt>
      <dd>
        <code>{bank.details.account}</code>
      </dd>
      {bank.details.routing && (
        <>
          <dt>{d.sellerBank.routing}</dt>
          <dd>
            <code>{bank.details.routing}</code>
          </dd>
        </>
      )}
    </dl>
  )
}
export function PayoutBankReview({
  tenantId,
  payoutId,
  bank,
  status,
  d,
}: {
  tenantId: string
  payoutId: string
  bank: PayoutBank
  status: string
  d: Dictionary
}) {
  const state = useBankSave(d),
    t = d.sellerBank,
    open = ['requested', 'approved'].includes(status)
  const display = open ? bank.current : bank.reviewed
  return (
    <details className="payout-bank">
      <summary>
        {t.title}
        {open && bank.needsReview ? ' · ' + t.review : ''}
      </summary>
      {display ? <SellerBankAccount bank={display} d={d} /> : <p>{t.empty}</p>}
      {open && bank.current && (
        <>
          {bank.needsReview ? (
            <>
              <p>{bank.reviewed ? t.changed : t.review}</p>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={state.busy || state.refused}
                onClick={() =>
                  void state.save({
                    action: 'review',
                    tenantId,
                    payoutId,
                    requestId: crypto.randomUUID(),
                    version: bank.current!.id,
                  })
                }
              >
                {t.use}
              </button>
            </>
          ) : (
            <p>{t.reviewed}</p>
          )}
          <p>{t.manual}</p>
        </>
      )}
      {open && bank.reviewed && bank.needsReview && (
        <details>
          <summary>{t.snapshot}</summary>
          <SellerBankAccount bank={bank.reviewed} d={d} />
        </details>
      )}
      {state.message && <p role="status">{state.message}</p>}
      {state.refused && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => window.location.reload()}
        >
          {d.itemWorkflow.reload}
        </button>
      )}
    </details>
  )
}

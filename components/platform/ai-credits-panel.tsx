'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import {
  formatCreditPrice,
  type CreditPrice,
} from '@/lib/platform/credit-prices'
import { credits, type AiCredits } from '@/lib/engine/ai-credits'

/** AI credits under Settings: what is left this month, how to get more, and the store's own key. */
export function AiCreditsPanel({
  tenantId,
  state,
  canManage,
  canBuy,
  price,
  locale,
  d,
}: {
  tenantId: string
  state: AiCredits
  canManage: boolean
  canBuy: boolean
  price: CreditPrice
  locale: string
  d: Dictionary['credits']
}) {
  const running = useRef(false)
  const [current, setCurrent] = useState(state)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [model, setModel] = useState('gpt-4.1-mini')
  const [key, setKey] = useState('')
  const fill = (text: string) =>
    text
      .replaceAll('{included}', String(credits(current.includedOre)))
      .replaceAll('{left}', String(credits(current.includedLeftOre)))
      .replaceAll('{purchased}', String(credits(current.purchasedLeftOre)))
      .replaceAll('{used}', String(credits(current.usedThisPeriodOre)))
      .replaceAll('{pack}', '100')
      .replaceAll('{price}', formatCreditPrice(price, locale))
      .replaceAll('{items}', new Intl.NumberFormat(locale).format(4000))
      .replaceAll('{model}', current.ownModel ?? '')
  async function post(url: string, body: object, label: string) {
    if (running.current) return null
    running.current = true
    setBusy(label)
    setMessage('')
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...body }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setMessage(
          data.error === 'STRIPE_NOT_CONFIGURED'
            ? d.buyUnavailable
            : data.error === 'INVALID_INPUT'
              ? d.keyInvalid
              : d.failed,
        )
        return null
      }
      return data
    } catch {
      setMessage(d.failed)
      return null
    } finally {
      running.current = false
      setBusy('')
    }
  }
  async function buy() {
    const data = await post('/api/billing', { action: 'credits' }, 'buy')
    if (data?.url) window.location.assign(data.url)
  }
  async function connect() {
    const data = await post(
      '/api/ai/connection',
      { action: 'connect', model, key },
      'connect',
    )
    if (data?.credits) {
      setCurrent(data.credits)
      setKey('')
      setMessage(d.keyConnected)
    }
  }
  async function remove() {
    const data = await post(
      '/api/ai/connection',
      { action: 'remove' },
      'remove',
    )
    if (data?.credits) {
      setCurrent(data.credits)
      setMessage(d.keyRemoved)
    }
  }
  return (
    <section className="card intake-form" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.intro}</p>
      <p>{fill(d.offer)}</p>
      {!current.enabled && <p>{d.selfHosted}</p>}
      {current.enabled && (
        <dl className="intake-summary">
          <div>
            <dt>{d.includedLeft}</dt>
            <dd>{fill('{left} / {included}')}</dd>
          </div>
          <div>
            <dt>{d.purchasedLeft}</dt>
            <dd>{fill('{purchased}')}</dd>
          </div>
          <div>
            <dt>{d.usedThisMonth}</dt>
            <dd>{fill('{used}')}</dd>
          </div>
        </dl>
      )}
      {current.enabled && current.capReached && !current.ownKey && (
        <p role="status">{d.capReached}</p>
      )}
      {current.ownKey && <p role="status">{fill(d.ownKeyActive)}</p>}
      {current.enabled && canBuy && !current.ownKey && (
        <div className="row">
          <Button disabled={busy !== ''} onClick={buy}>
            {busy === 'buy' ? d.working : fill(d.buy)}
          </Button>
        </div>
      )}
      {canManage && (
        <>
          <h3>{d.ownKeyHeading}</h3>
          <p>{d.ownKeyIntro}</p>
          {!current.ownKey && (
            <div className="intake-form">
              <div className="field">
                <label htmlFor="ai-model">{d.model}</label>
                <input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="field">
                <label htmlFor="ai-key">{d.key}</label>
                <input
                  id="ai-key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  maxLength={400}
                />
                <small>{d.keyHint}</small>
              </div>
              <div className="row">
                <Button
                  variant="secondary"
                  disabled={busy !== '' || key.length < 20}
                  onClick={connect}
                >
                  {busy === 'connect' ? d.working : d.connect}
                </Button>
              </div>
            </div>
          )}
          {current.ownKey && (
            <div className="row">
              <Button
                variant="secondary"
                disabled={busy !== ''}
                onClick={remove}
              >
                {busy === 'remove' ? d.working : d.removeKey}
              </Button>
            </div>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}

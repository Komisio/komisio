'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { GuideCopy } from '@/lib/guide-copy'
import {
  emptyGuide,
  guideOptions,
  guideSteps,
  pricingOptions,
  rentalOnly,
  type CurrentGuide,
  type GuideAnswers,
  type GuideKey,
} from '@/lib/engine/store-guide'
import './store-guide.css'

export function StoreGuide({
  tenantId,
  tenantName,
  initial,
  editable,
  c,
}: {
  tenantId: string
  tenantName: string
  initial: CurrentGuide
  editable: boolean
  c: GuideCopy
}) {
  const router = useRouter()
  const [answers, setAnswers] = useState<GuideAnswers>(
    initial.answers ?? emptyGuide(),
  )
  const [step, setStep] = useState(
    initial.answers ? guideSteps(initial.answers).length : 0,
  )
  const [currentId, setCurrentId] = useState(initial.id)
  const [saved, setSaved] = useState(!!initial.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const steps = guideSteps(answers)
  const summary = step >= steps.length || !editable
  const key = steps[Math.min(step, steps.length - 1)]
  const title = (k: GuideKey) =>
    k === 'pricing' && rentalOnly(answers) ? c.checkout : c[k]
  const labels: Record<GuideKey, Record<string, string>> = {
    intake: {
      single: c.singleItem,
      bags: c.bags,
      owned: c.owned,
      new: c.new,
      pickup: c.pickup,
      space: c.space,
      other: c.other,
    },
    goods: {
      clothes: c.clothes,
      kids: c.kids,
      home: c.homeGoods,
      furniture: c.furniture,
      hobby: c.hobby,
      mixed: c.mixed,
      other: c.other,
    },
    pricing: {
      store: c.store,
      together: c.together,
      seller: c.seller,
      suggestion: c.suggestion,
      both: c.both,
      later: c.later,
    },
    period: {
      collect: c.collect,
      donate: c.donate,
      extend: c.extend,
      individual: c.individual,
      later: c.later,
    },
    pos: {
      zettle: 'PayPal POS',
      shopify: 'Shopify POS',
      other: c.other,
      later: c.later,
    },
    channels: {
      shop: c.shop,
      web: c.web,
      social: c.social,
      market: c.market,
      later: c.later,
    },
  }
  function move(to: number) {
    setStep(to)
    setError('')
    request.current = null
    setTimeout(() => heading.current?.focus(), 0)
  }
  function choose(value: string) {
    const multi = !['pricing', 'pos'].includes(key)
    let values = multi
      ? answers[key].includes(value)
        ? answers[key].filter((x) => x !== value)
        : [...answers[key], value]
      : [value]
    if (value === 'later' && values.includes(value)) values = ['later']
    else if (value !== 'later') values = values.filter((x) => x !== 'later')
    // Keep a stable canonical order for retries and version comparisons.
    values = guideOptions[key].filter((x) => values.includes(x))
    setAnswers({
      ...answers,
      [key]: values,
      ...(key === 'intake' ? { pricing: [], period: [] } : {}),
    })
    request.current = null
    setSaved(false)
    setError('')
  }
  async function save() {
    setBusy(true)
    setError('')
    request.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/store-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          requestId: request.current,
          expectedCurrentId: currentId,
          answers,
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(
          body.error === 'TENANT_CHANGED'
            ? c.tenantChanged
            : ['GUIDE_CHANGED', 'REQUEST_CONFLICT'].includes(body.error)
              ? c.conflict
              : body.error === 'AUTH_REQUIRED'
                ? c.auth
                : c.failed,
        )
        return
      }
      setCurrentId(body.id)
      setSaved(true)
      request.current = null
      router.refresh()
    } catch {
      setError(c.failed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="store-guide" aria-label={c.start}>
      <p>
        {summary ? c.summary : `${c.step} ${step + 1} ${c.of} ${steps.length}`}
      </p>
      <progress
        aria-label={c.start}
        max={steps.length}
        value={summary ? steps.length : step}
      />
      <h1 ref={heading} tabIndex={-1}>
        {summary ? c.summary : title(key)}
      </h1>
      {!editable && <p>{c.readonly}</p>}
      {summary ? (
        <>
          <dl>
            {steps.map((k) => (
              <div className="guide-summary-row" key={k}>
                <dt>{title(k)}</dt>
                <dd>
                  {answers[k].map((v) => labels[k][v]).join(' · ') || c.later}
                </dd>
              </div>
            ))}
          </dl>
          <p>{c.notice}</p>
          {(answers.intake.some((x) =>
            ['space', 'pickup', 'new'].includes(x),
          ) ||
            answers.channels.includes('market')) && <p>{c.unsupported}</p>}
        </>
      ) : (
        <>
          <p>{['pricing', 'pos'].includes(key) ? c.single : c.multi}</p>
          <fieldset disabled={busy} className="guide-options">
            <legend className="sr-only">{title(key)}</legend>
            {(key === 'pricing'
              ? pricingOptions(answers)
              : guideOptions[key]
            ).map((value) => (
              <label
                key={value}
                className={answers[key].includes(value) ? 'selected' : ''}
              >
                <input
                  type={['pricing', 'pos'].includes(key) ? 'radio' : 'checkbox'}
                  name={key}
                  checked={answers[key].includes(value)}
                  onChange={() => choose(value)}
                />
                <span>{labels[key][value]}</span>
              </label>
            ))}
          </fieldset>
        </>
      )}
      <div className="guide-actions">
        {editable &&
          (summary ? (
            <button type="button" disabled={busy} onClick={() => move(0)}>
              {c.edit}
            </button>
          ) : (
            step > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => move(step - 1)}
              >
                {c.back}
              </button>
            )
          ))}
        {!summary && (
          <button
            type="button"
            disabled={busy || !answers[key].length}
            onClick={() => move(step + 1)}
          >
            {step === steps.length - 1 ? c.summary : c.next} →
          </button>
        )}
        {summary && editable && !saved && (
          <button type="button" disabled={busy} onClick={save}>
            {busy ? c.saving : c.save}
          </button>
        )}
        {summary && <Link href="/">{c.home}</Link>}
      </div>
      {saved && summary && (
        <p role="status">
          ✓ {c.saved} {tenantName}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}

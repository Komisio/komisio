'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import { credits, type AiPlatformSettings } from '@/lib/engine/ai-credits'
import type { PlanOverviewRow } from '@/lib/engine/plans'

/** The host's AI settings: the platform cap, the included amount, the pack, the model prices and the showcase. Amounts in whole kronor. */
export function HostAi({
  settings,
  stores,
  d,
}: {
  settings: AiPlatformSettings
  stores: PlanOverviewRow[]
  d: Dictionary['credits']['host']
}) {
  const running = useRef(false)
  const [current, setCurrent] = useState(settings)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    enabled: settings.enabled,
    monthlyCap: String(credits(settings.monthlyCapOre)),
    included: String(credits(settings.includedOre)),
    pack: String(credits(settings.packOre)),
    reserveOre: String(settings.reserveOre),
    reserveBatchOre: String(settings.reserveBatchOre),
    inputOrePerMillion: String(settings.inputOrePerMillion),
    outputOrePerMillion: String(settings.outputOrePerMillion),
    connectorDailyCap: String(settings.connectorDailyCap),
    emailDailyCap: String(settings.emailDailyCap),
    inviteDailyCap: String(settings.inviteDailyCap),
  })
  const [showcaseTenant, setShowcaseTenant] = useState(
    stores[0]?.tenant_id ?? '',
  )
  const [showcaseLabel, setShowcaseLabel] = useState('')
  async function post(body: object) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch('/api/host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setMessage(d.failed)
        return
      }
      setCurrent(data)
      setMessage(d.saved)
    } catch {
      setMessage(d.failed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const kr = (v: string) => Math.round(Number(v) * 100)
  return (
    <section className="card intake-form" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.intro}</p>
      <p>
        {d.capUsed
          .replace('{used}', String(credits(current.capUsedOre)))
          .replace('{cap}', String(credits(current.monthlyCapOre)))
          .replace('{period}', current.period)}
      </p>
      <label className="intake-confirm">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        {d.enabled}
      </label>
      {(
        [
          ['monthlyCap', d.monthlyCap],
          ['included', d.included],
          ['pack', d.pack],
          ['reserveOre', d.reserveOre],
          ['reserveBatchOre', d.reserveBatchOre],
          ['inputOrePerMillion', d.inputOrePerMillion],
          ['outputOrePerMillion', d.outputOrePerMillion],
          ['connectorDailyCap', d.connectorDailyCap],
          ['emailDailyCap', d.emailDailyCap],
          ['inviteDailyCap', d.inviteDailyCap],
        ] as const
      ).map(([name, label]) => (
        <div className="field" key={name}>
          <label htmlFor={`ai-${name}`}>{label}</label>
          <input
            id={`ai-${name}`}
            inputMode="decimal"
            value={form[name]}
            onChange={(e) => setForm({ ...form, [name]: e.target.value })}
          />
        </div>
      ))}
      <div className="row">
        <Button
          disabled={busy}
          onClick={() =>
            post({
              action: 'aiSettings',
              settings: {
                enabled: form.enabled,
                monthlyCapOre: kr(form.monthlyCap),
                includedOre: kr(form.included),
                packOre: kr(form.pack),
                reserveOre: Math.round(Number(form.reserveOre)),
                reserveBatchOre: Math.round(Number(form.reserveBatchOre)),
                inputOrePerMillion: Number(form.inputOrePerMillion),
                outputOrePerMillion: Number(form.outputOrePerMillion),
                connectorDailyCap: Math.round(Number(form.connectorDailyCap)),
                emailDailyCap: Math.round(Number(form.emailDailyCap)),
                inviteDailyCap: Math.round(Number(form.inviteDailyCap)),
              },
            })
          }
        >
          {busy ? d.working : d.save}
        </Button>
      </div>
      <h3>{d.showcaseHeading}</h3>
      <p>{d.showcaseIntro}</p>
      <ul>
        {current.showcase.map((s) => (
          <li key={s.tenantId}>
            {s.label}{' '}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                post({ action: 'showcase', tenantId: s.tenantId, label: '' })
              }
            >
              {d.showcaseRemove}
            </Button>
          </li>
        ))}
      </ul>
      <div className="field">
        <label htmlFor="showcase-store">{d.showcaseStore}</label>
        <select
          id="showcase-store"
          value={showcaseTenant}
          onChange={(e) => setShowcaseTenant(e.target.value)}
        >
          {stores.map((s) => (
            <option key={s.tenant_id} value={s.tenant_id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="showcase-label">{d.showcaseLabel}</label>
        <input
          id="showcase-label"
          value={showcaseLabel}
          maxLength={120}
          onChange={(e) => setShowcaseLabel(e.target.value)}
        />
      </div>
      <div className="row">
        <Button
          variant="secondary"
          disabled={busy || !showcaseTenant || !showcaseLabel.trim()}
          onClick={() =>
            post({
              action: 'showcase',
              tenantId: showcaseTenant,
              label: showcaseLabel.trim(),
            })
          }
        >
          {d.showcaseAdd}
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  )
}

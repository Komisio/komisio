'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import { credits, type AiPlatformSettings } from '@/lib/engine/ai-credits'

/** The host's AI settings: the platform cap, the included amount, the pack, the model prices. Amounts in whole kronor. */
export function HostAi({
  settings,
  d,
}: {
  settings: AiPlatformSettings
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
    emailNewCap: String(settings.emailNewCap),
    inviteNewCap: String(settings.inviteNewCap),
    emailTrustDays: String(settings.emailTrustDays),
  })
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
    <section
      className="card intake-form host-settings"
      aria-label={d.adminHeading}
    >
      <h2>{d.adminHeading}</h2>
      <p>{d.adminIntro}</p>
      <details className="host-setting-group">
        <summary>{d.title}</summary>
        <div className="host-setting-content">
          <p>{d.intro}</p>
          <p>
            {d.capUsed
              .replace('{used}', String(credits(current.capUsedOre)))
              .replace('{cap}', String(credits(current.monthlyCapOre)))
              .replace('{period}', current.period)}
          </p>
          <label className="intake-confirm">
            <input
              disabled={busy}
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            {d.enabled}
          </label>
          {(
            [
              [
                d.budgetHeading,
                [
                  ['monthlyCap', d.monthlyCap],
                  ['included', d.included],
                  ['pack', d.pack],
                ],
              ],
              [
                d.modelHeading,
                [
                  ['reserveOre', d.reserveOre],
                  ['reserveBatchOre', d.reserveBatchOre],
                  ['inputOrePerMillion', d.inputOrePerMillion],
                  ['outputOrePerMillion', d.outputOrePerMillion],
                ],
              ],
              [
                d.limitsHeading,
                [
                  ['connectorDailyCap', d.connectorDailyCap],
                  ['emailDailyCap', d.emailDailyCap],
                  ['inviteDailyCap', d.inviteDailyCap],
                  ['emailNewCap', d.emailNewCap],
                  ['inviteNewCap', d.inviteNewCap],
                  ['emailTrustDays', d.emailTrustDays],
                ],
              ],
            ] as const
          ).map(([heading, fields]) => (
            <fieldset className="host-setting-fields" key={heading}>
              <legend>{heading}</legend>
              <div className="host-field-grid">
                {fields.map(([name, label]) => (
                  <div className="field" key={name}>
                    <label htmlFor={`ai-${name}`}>{label}</label>
                    <input
                      id={`ai-${name}`}
                      inputMode="decimal"
                      value={form[name]}
                      disabled={busy}
                      onChange={(e) =>
                        setForm({ ...form, [name]: e.target.value })
                      }
                    />
                  </div>
                ))}
              </div>
            </fieldset>
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
                    connectorDailyCap: Math.round(
                      Number(form.connectorDailyCap),
                    ),
                    emailDailyCap: Math.round(Number(form.emailDailyCap)),
                    inviteDailyCap: Math.round(Number(form.inviteDailyCap)),
                    emailNewCap: Math.round(Number(form.emailNewCap)),
                    inviteNewCap: Math.round(Number(form.inviteNewCap)),
                    emailTrustDays: Math.round(Number(form.emailTrustDays)),
                  },
                })
              }
            >
              {busy ? d.working : d.save}
            </Button>
          </div>
        </div>
      </details>
      {message && <p role="status">{message}</p>}
    </section>
  )
}

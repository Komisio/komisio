'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { ShopifySettingsStatus } from '@/lib/engine/shopify-settings'

type Options = {
  locations: { id: string; name: string }[]
  publications: { id: string; name: string }[]
}
export function ShopifySetup({
  tenantId,
  status,
  d,
}: {
  tenantId: string
  status: ShopifySettingsStatus
  d: Dictionary['shopify']
}) {
  const router = useRouter(),
    running = useRef(false)
  const t = d.setup
  const [options, setOptions] = useState<Options | null>(null)
  const [mode, setMode] = useState(status.settings?.mode ?? 'both')
  const [location, setLocation] = useState(status.settings?.locationId ?? '')
  const [web, setWeb] = useState(status.settings?.webPublicationId ?? '')
  const [pos, setPos] = useState(status.settings?.posPublicationId ?? '')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function post(save: boolean) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/integrations/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action: save ? 'saveSettings' : 'setupOptions',
          ...(save
            ? {
                revision: status.revision,
                settings: {
                  mode,
                  locationId: location,
                  locationName:
                    options?.locations.find((l) => l.id === location)?.name ??
                    '',
                  webPublicationId: mode === 'pos' ? null : web,
                  posPublicationId: mode === 'web' ? null : pos,
                },
              }
            : {}),
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(
          (d.errors as Record<string, string>)[body.error] ??
            d.connectionFailed,
        )
        return
      }
      if (save) {
        setOptions(null)
        router.refresh()
      } else setOptions(body)
    } catch {
      setError(d.connectionFailed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card intake-form shopify-setup" aria-label={t.title}>
      <h2>{t.title}</h2>
      <p>{t.intro}</p>
      {status.settings && (
        <p>
          {t.modes[status.settings.mode]} · {status.settings.locationName}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status.locked ? (
        <p>{status.settings ? t.locked : t.legacy}</p>
      ) : !options ? (
        <>
          <p>{t.permissions}</p>
          <Button disabled={busy} onClick={() => post(false)}>
            {busy ? d.busy : t.configure}
          </Button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void post(true)
          }}
        >
          <fieldset disabled={busy}>
            <legend>{t.mode}</legend>
            {(['web', 'pos', 'both'] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="shopify-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {t.modes[value]}
              </label>
            ))}
          </fieldset>
          <label>
            {t.location}
            <select
              required
              disabled={busy}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">{t.choose}</option>
              {options.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {mode !== 'pos' && (
            <label>
              {t.webPublication}
              <select
                required
                disabled={busy}
                value={web}
                onChange={(e) => setWeb(e.target.value)}
              >
                <option value="">{t.choose}</option>
                {options.publications.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode !== 'web' && (
            <label>
              {t.posPublication}
              <select
                required
                disabled={busy}
                value={pos}
                onChange={(e) => setPos(e.target.value)}
              >
                <option value="">{t.choose}</option>
                {options.publications.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p>{t.lockHint}</p>
          <Button
            type="submit"
            disabled={
              busy ||
              !location ||
              (mode !== 'pos' && !web) ||
              (mode !== 'web' && !pos) ||
              (mode === 'both' && web === pos)
            }
          >
            {busy ? d.busy : t.save}
          </Button>
        </form>
      )}
    </section>
  )
}

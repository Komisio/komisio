'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { intlLocale, type Dictionary } from '@/lib/i18n'
import type { PrintDevice } from '@/lib/engine/print-devices'

/** Pair the computer at a printer with a one-time code; see and disconnect devices. */
export function PrintDevices({
  tenantId,
  printerId,
  devices,
  canManage,
  downloadUrl,
  locale,
  d,
}: {
  tenantId: string
  printerId: string
  downloadUrl: string
  devices: PrintDevice[]
  canManage: boolean
  locale: string
  d: Dictionary['printing']
}) {
  const running = useRef(false)
  const [list, setList] = useState(devices)
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(locale), {
      timeZone: 'Europe/Stockholm',
    })
  async function post(body: object) {
    if (running.current) return null
    running.current = true
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch('/api/print/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...body }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setMessage(
          data.error === 'PLAN_LIMIT_DEVICES' ? d.deviceLimit : d.codeFailed,
        )
        return null
      }
      return data
    } catch {
      setMessage(d.codeFailed)
      return null
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div>
      <h4>{d.devicesTitle}</h4>
      <p>{d.devicesIntro}</p>
      <ol>
        <li>
          <a className="text-link" href={downloadUrl}>
            {d.download}
          </a>
          . {d.deviceStep1}
        </li>
        <li>{d.deviceStep2}</li>
        <li>{d.deviceStep3}</li>
      </ol>
      {canManage && (
        <div className="row">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              const r = await post({ action: 'pairingCode', printerId })
              if (r?.code) setCode({ code: r.code, expiresAt: r.expiresAt })
            }}
          >
            {d.newCode}
          </Button>
        </div>
      )}
      {code && (
        <p role="status">
          {d.codeReady.replace('{time}', when(code.expiresAt))}{' '}
          <strong style={{ fontSize: '1.4em', letterSpacing: '0.1em' }}>
            {code.code}
          </strong>
        </p>
      )}
      {message && <p role="alert">{message}</p>}
      {list.length === 0 ? (
        <p>{d.noDevices}</p>
      ) : (
        <ul>
          {list.map((x) => (
            <li key={x.id}>
              <strong>{x.name}</strong>
              {x.version ? ` ${x.version}` : ''}
              {' · '}
              {x.revokedAt
                ? d.deviceRevoked
                : x.lastSeenAt
                  ? `${d.deviceSeen} ${when(x.lastSeenAt)} · ${
                      x.printerReachable === false
                        ? d.printerUnreachable
                        : d.printerReachable
                    }`
                  : d.deviceNeverSeen}
              {x.lastError ? ` · ${x.lastError}` : ''}
              {canManage && !x.revokedAt && (
                <>
                  {' '}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      const r = await post({ action: 'revoke', deviceId: x.id })
                      if (r?.devices) {
                        setList(
                          (r.devices as PrintDevice[]).filter(
                            (y) => y.printerId === printerId,
                          ),
                        )
                        setMessage(d.revoked)
                      }
                    }}
                  >
                    {d.revokeDevice}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

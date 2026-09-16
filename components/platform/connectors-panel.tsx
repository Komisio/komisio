'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { ConnectorGrant } from '@/lib/engine/connectors'

/** The assistants connected to the store: who approved them, what they may do, and a way to disconnect. */
export function ConnectorsPanel({
  tenantId,
  connectors,
  endpoint,
  plus,
  locale,
  d,
}: {
  tenantId: string
  connectors: ConnectorGrant[]
  endpoint: string
  plus: boolean
  locale: string
  d: Dictionary['connectors']
}) {
  const running = useRef(false)
  const [list, setList] = useState(connectors)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(locale === 'sv' ? 'sv-SE' : 'en-GB', {
          timeZone: 'Europe/Stockholm',
        })
      : d.never
  async function disconnect(grantId: string) {
    if (running.current) return
    running.current = true
    setBusy(grantId)
    setMessage('')
    try {
      const r = await fetch('/api/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, grantId }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setMessage(d.disconnectFailed)
        return
      }
      setList(data.connectors ?? [])
      setMessage(d.disconnected)
    } catch {
      setMessage(d.disconnectFailed)
    } finally {
      running.current = false
      setBusy('')
    }
  }
  return (
    <section className="card intake-form" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.intro}</p>
      {!plus && <p role="status">{d.plusRequired}</p>}
      <h3>{d.howToHeading}</h3>
      <ol>
        <li>
          {d.howTo1} <code>{endpoint}</code>
        </li>
        <li>{d.howTo2}</li>
        <li>{d.howTo3}</li>
      </ol>
      <h3>{d.connectedHeading}</h3>
      {list.length === 0 && <p>{d.none}</p>}
      {list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{d.client}</th>
                <th>{d.person}</th>
                <th>{d.scopesLabel}</th>
                <th>{d.created}</th>
                <th>{d.lastUsed}</th>
                <th>{d.calls}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id}>
                  <td>{g.clientName}</td>
                  <td>{g.userName ?? ''}</td>
                  <td>
                    {g.scopes
                      .map((s) => d.scopes[s as keyof typeof d.scopes] ?? s)
                      .join(', ')}
                  </td>
                  <td>{when(g.createdAt)}</td>
                  <td>{when(g.lastUsedAt)}</td>
                  <td>{g.calls}</td>
                  <td>
                    <Button
                      variant="secondary"
                      disabled={busy !== ''}
                      onClick={() => disconnect(g.id)}
                    >
                      {busy === g.id ? d.disconnecting : d.disconnect}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}

'use client'
import { useBusyState } from '@/components/platform/work-activity'
import { Fragment, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { intlLocale, type Dictionary } from '@/lib/i18n'
import type { ConnectorGrant } from '@/lib/engine/connectors'
import {
  permissionLevels,
  summarizeConnectorPermissions,
} from '@/lib/platform/connector-permissions'

/** The assistants connected to the store: who approved them, what they may do, and a way to disconnect. */
export function ConnectorsPanel({
  tenantId,
  connectors,
  endpoint,
  locale,
  d,
}: {
  tenantId: string
  connectors: ConnectorGrant[]
  endpoint: string
  locale: string
  d: Dictionary['connectors']
}) {
  const running = useRef(false)
  const [list, setList] = useState(connectors)
  const [busy, setBusy] = useBusyState('')
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(intlLocale(locale), {
          timeZone: 'Europe/Stockholm',
          dateStyle: 'medium',
          timeStyle: 'short',
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
    <section className="card intake-form connectors-panel" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.intro}</p>
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
        <div className="connectors-list">
          <table
            className="connectors-table"
            role="table"
            aria-label={d.connectedHeading}
          >
            <thead>
              <tr>
                <th scope="col">{d.client}</th>
                <th scope="col">{d.scopesLabel}</th>
                <th scope="col">{d.activity}</th>
                <th scope="col">
                  <span className="sr-only">{d.disconnect}</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {list.map((g) => {
                const permissions = summarizeConnectorPermissions(g.scopes)
                const open = expanded.includes(g.id)
                const detailsId = `connector-permissions-${g.id}`
                return (
                  <Fragment key={g.id}>
                    <tr
                      className="connector-row"
                      role="row"
                      data-expanded={open}
                    >
                      <th
                        scope="row"
                        role="rowheader"
                        className="connector-identity"
                      >
                        <strong>{g.clientName}</strong>
                        <span className="connector-approver">
                          <span>{d.person}</span>
                          {g.userName || '—'}
                        </span>
                      </th>
                      <td role="cell" className="connector-permissions">
                        <div className="connector-permission-badges">
                          {permissionLevels
                            .filter((level) => permissions.counts[level] > 0)
                            .map((level) => (
                              <span className="badge" key={level}>
                                {d.accessLevels[level]}{' '}
                                <strong>
                                  {permissions.counts[level].toLocaleString(
                                    intlLocale(locale),
                                  )}
                                </strong>
                              </span>
                            ))}
                        </div>
                        <button
                          type="button"
                          className="text-link connector-permissions-toggle"
                          aria-expanded={open}
                          aria-controls={detailsId}
                          aria-label={`${open ? d.hidePermissions : d.showPermissions}: ${g.clientName}`}
                          onClick={() =>
                            setExpanded((ids) =>
                              open
                                ? ids.filter((id) => id !== g.id)
                                : [...ids, g.id],
                            )
                          }
                        >
                          {open ? d.hidePermissions : d.showPermissions}
                          <ChevronDown size={16} aria-hidden="true" />
                        </button>
                      </td>
                      <td role="cell">
                        <dl className="connector-activity">
                          <div>
                            <dt>{d.created}</dt>
                            <dd>
                              <time dateTime={g.createdAt}>
                                {when(g.createdAt)}
                              </time>
                            </dd>
                          </div>
                          <div>
                            <dt>{d.lastUsed}</dt>
                            <dd>
                              {g.lastUsedAt ? (
                                <time dateTime={g.lastUsedAt}>
                                  {when(g.lastUsedAt)}
                                </time>
                              ) : (
                                d.never
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>{d.calls}</dt>
                            <dd>
                              {g.calls.toLocaleString(intlLocale(locale))}
                            </dd>
                          </div>
                        </dl>
                      </td>
                      <td role="cell" className="connector-actions">
                        <Button
                          variant="secondary"
                          disabled={busy !== ''}
                          onClick={() => disconnect(g.id)}
                        >
                          {busy === g.id ? d.disconnecting : d.disconnect}
                        </Button>
                      </td>
                    </tr>
                    <tr
                      role="row"
                      className="connector-details-row"
                      hidden={!open}
                    >
                      <td role="cell" colSpan={4}>
                        <div
                          id={detailsId}
                          role="region"
                          aria-label={`${d.scopesLabel}: ${g.clientName}`}
                        >
                          <ul className="connector-permission-groups">
                            {permissions.groups.map((group) => (
                              <li key={group.area}>
                                <strong>{d.areas[group.area]}</strong>
                                <ul>
                                  {group.scopes.map((scope) => (
                                    <li key={scope}>
                                      {Object.hasOwn(d.scopes, scope)
                                        ? d.scopes[
                                            scope as keyof typeof d.scopes
                                          ]
                                        : scope}
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}

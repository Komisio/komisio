'use client'
import { useState } from 'react'
import { storeScopes } from '@/lib/engine/store-api-contract'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import type { z } from 'zod'
import type { inventoryKey } from '@/lib/engine/store-inventory-api'

export function StoreApiKeys({
  tenantId,
  locale,
  d,
  keys,
}: {
  tenantId: string
  locale: string
  d: Dictionary['storeApi']
  keys: z.infer<typeof inventoryKey>[]
}) {
  const router = useRouter()
  const [scopes, setScopes] = useState<string[]>(['items:read'])
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function change(
    command:
      { action: 'issue'; label: string } | { action: 'revoke'; id: string },
  ) {
    setBusy(true)
    setError('')
    setSecret('')
    try {
      const r = await fetch('/api/integrations/store-api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...command,
          tenantId,
          ...(command.action === 'issue' ? { scopes } : {}),
        }),
      })
      const data = await r.json()
      if (!r.ok) {
        setError(data.error === 'KEY_LIMIT' ? d.limit : d.error)
        return
      }
      if (command.action === 'issue') {
        setSecret(data.secret)
        setLabel('')
      }
      router.refresh()
    } catch {
      setError(d.error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card stack">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void change({ action: 'issue', label: label.trim() })
        }}
      >
        <label>
          {d.label}
          <input
            required
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>{d.permissions}</legend>
          {storeScopes.map((scope) => (
            <label key={scope}>
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(e) =>
                  setScopes((prev) =>
                    e.target.checked
                      ? [...prev, scope]
                      : prev.filter((s) => s !== scope),
                  )
                }
              />
              {scope}
            </label>
          ))}
        </fieldset>
        <button
          className="btn"
          disabled={busy || !label.trim() || !scopes.length}
        >
          {d.create}
        </button>
      </form>
      {secret && (
        <div role="status">
          <label>
            {d.copy}
            <input
              readOnly
              value={secret}
              autoComplete="off"
              spellCheck={false}
              onFocus={(e) => e.target.select()}
            />
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {keys.length > 0 && (
        <ul>
          {keys.map((k) => (
            <li key={k.id}>
              <strong>{k.label}</strong> <small>{k.scopes.join(', ')}</small>
              {' · '}
              {d.expires}{' '}
              {new Intl.DateTimeFormat(locale).format(new Date(k.expiresAt))}{' '}
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                aria-label={d.revoke + ' ' + k.label}
                onClick={() => void change({ action: 'revoke', id: k.id })}
              >
                {d.revoke}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

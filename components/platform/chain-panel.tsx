'use client'
import { useRef } from 'react'
import type { Dictionary } from '@/lib/i18n'
import type { Tenant } from '@/lib/platform/types'
import type { ChainOverview } from '@/lib/engine/chains'
import { Button } from '@/components/ui/button'
import { useCommand } from './use-command'
import { Feedback } from './feedback'

/** Owner's chain controls on the settings page: create from owned stores, add a store, leave. */
export function ChainPanel({
  d,
  active,
  tenants,
  chain,
}: {
  d: Dictionary
  active: Tenant
  tenants: Tenant[]
  chain: ChainOverview
}) {
  const c = d.chain
  const action = useCommand(d)
  const requestId = useRef<string | null>(null)
  const owned = tenants.filter((t) => t.role === 'owner')
  const inChain = new Set(chain?.stores.map((s) => s.id) ?? [])
  const candidates = owned.filter(
    (t) => t.id !== active.id && !inChain.has(t.id),
  )

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    requestId.current ??= crypto.randomUUID()
    await action.run({
      action: 'chainCreate',
      tenantId: active.id,
      chainId: requestId.current,
      name: form.get('name'),
      tenantIds: [active.id, ...form.getAll('store').map(String)],
    })
  }
  async function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!chain) return
    await action.run({
      action: 'chainJoin',
      tenantId: active.id,
      chainId: chain.id,
      storeId: form.get('store'),
    })
  }

  if (!chain)
    return (
      <form onSubmit={create}>
        <p>{c.intro}</p>
        <div className="field">
          <label htmlFor="chain-name">{c.name}</label>
          <input
            id="chain-name"
            name="name"
            required
            maxLength={100}
            placeholder={c.namePlaceholder}
          />
        </div>
        {candidates.length > 0 && (
          <fieldset className="field">
            <legend>{c.includeStores}</legend>
            {candidates.map((t) => (
              <label key={t.id} className="row">
                <input type="checkbox" name="store" value={t.id} /> {t.name}
              </label>
            ))}
          </fieldset>
        )}
        <Button disabled={action.busy}>
          {action.busy ? d.loading : c.create}
        </Button>
        <Feedback error={action.error} success={action.success} />
      </form>
    )

  return (
    <div>
      <p>
        <strong>{chain.name}</strong> ·{' '}
        {c.storesInChain.replace('{count}', String(chain.stores.length))}
      </p>
      <ul>
        {chain.stores.map((s) => (
          <li key={s.id}>
            {s.name}
            {s.role ? ` · ${d.roles[s.role]}` : ` · ${c.notMember}`}
          </li>
        ))}
      </ul>
      {candidates.length > 0 && (
        <form onSubmit={join} className="row">
          <label htmlFor="chain-store">{c.addStore}</label>
          <select id="chain-store" name="store" required>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button variant="secondary" disabled={action.busy}>
            {c.add}
          </Button>
        </form>
      )}
      <Button
        variant="secondary"
        disabled={action.busy}
        onClick={() =>
          action.run({ action: 'chainLeave', tenantId: active.id })
        }
      >
        {c.leave}
      </Button>
      <p>
        <small>{c.leaveHint}</small>
      </p>
      <Feedback error={action.error} success={action.success} />
    </div>
  )
}

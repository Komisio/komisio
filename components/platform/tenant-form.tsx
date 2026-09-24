'use client'
import { useRef, useSyncExternalStore } from 'react'
import {
  storeCurrencies,
  suggestedStoreCurrency,
} from '@/lib/platform/currencies'
import type { Dictionary } from '@/lib/i18n'
import type { Tenant } from '@/lib/platform/types'
import { Button } from '@/components/ui/button'
import { useCommand } from './use-command'
import { Feedback } from './feedback'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false
export function TenantForm({
  d,
  tenant,
  locale = 'sv',
}: {
  d: Dictionary
  tenant?: Tenant
  locale?: string
}) {
  const action = useCommand(d)
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const requestId = useRef<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    requestId.current ??= crypto.randomUUID()
    const result = await action.run(
      tenant
        ? { action: 'rename', tenantId: tenant.id, name: form.get('name') }
        : {
            action: 'create',
            name: form.get('name'),
            slug: `store-${requestId.current}`,
            requestId: requestId.current,
            currency: form.get('currency'),
          },
    )
    if (result && !tenant) {
      action.router.push('/')
      action.router.refresh()
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="tenant-name">{d.tenantName}</label>
        <input
          id="tenant-name"
          name="name"
          defaultValue={tenant?.name}
          required
          maxLength={100}
          placeholder={d.tenantPlaceholder}
        />
      </div>
      {!tenant && (
        <div className="field">
          <label htmlFor="tenant-currency">{d.storePolicy.currency}</label>
          <select
            id="tenant-currency"
            name="currency"
            defaultValue={suggestedStoreCurrency(locale)}
            required
          >
            {storeCurrencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <p>{d.storePolicy.currencyIntro}</p>
        </div>
      )}
      <Button disabled={!ready || action.busy}>
        {action.busy ? d.loading : tenant ? d.save : d.createButton}
      </Button>
      <Feedback error={action.error} success={action.success} />
    </form>
  )
}
export function OpenTenant({ d, tenant }: { d: Dictionary; tenant: Tenant }) {
  const action = useCommand(d)
  return (
    <>
      <Button
        variant="secondary"
        disabled={action.busy}
        onClick={async () => {
          if (await action.run({ action: 'select', tenantId: tenant.id })) {
            action.router.push('/')
            action.router.refresh()
          }
        }}
      >
        {tenant.name}
        <span className="badge">{d.roles[tenant.role]}</span>
      </Button>
      <Feedback error={action.error} />
    </>
  )
}

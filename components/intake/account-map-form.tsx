'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import {
  accountingKeys,
  accountingMapBody,
  type AccountingMapBody,
} from '@/lib/engine/accounting'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

/** The tenant's account map: one account and side per day-close amount, or none. */
export function AccountMapForm({
  tenantId,
  current,
  editable,
  d,
  vatModes,
  intake,
}: {
  tenantId: string
  current: { id: string | null; version: number; map: AccountingMapBody }
  editable: boolean
  d: Dictionary['accounting']
  vatModes: Record<string, string>
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [base] = useState(current)
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  const label = (key: string) => {
    if (key.startsWith('mode:')) {
      const [, mode, amount] = key.split(':')
      return `${vatModes[mode] ?? mode} · ${amount === 'netOre' ? d.netOf : d.vatOf}`
    }
    return d.amountKeys[key as keyof typeof d.amountKeys] ?? key
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (action.locked) {
          if (await action.run({})) {
            setSaved(true)
            router.refresh()
          }
          return
        }
        const f = new FormData(e.currentTarget)
        const map: Record<string, { account: string; side: string }> = {}
        for (const key of accountingKeys) {
          const account = String(f.get(`account:${key}`) ?? '').trim()
          if (account)
            map[key] = {
              account,
              side: String(f.get(`side:${key}`) ?? 'debit'),
            }
        }
        const candidate = accountingMapBody.safeParse(map)
        setInvalid(!candidate.success)
        if (!candidate.success) return
        if (
          await action.run({
            action: 'publishAccountingMap',
            tenantId,
            requestId: crypto.randomUUID(),
            expectedCurrentId: base.id,
            map: candidate.data,
          })
        ) {
          setSaved(true)
          router.refresh()
        }
      }}
    >
      <p>{base.id ? `${d.mapVersion} ${base.version}` : d.noMap}</p>
      <fieldset
        className="intake-fields"
        disabled={!editable || action.locked || saved || action.needsReload}
      >
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th />
                <th>{d.account}</th>
                <th>{d.side}</th>
              </tr>
            </thead>
            <tbody>
              {accountingKeys.map((key) => (
                <tr key={key}>
                  <td>
                    <label htmlFor={`account:${key}`}>{label(key)}</label>
                  </td>
                  <td>
                    <input
                      id={`account:${key}`}
                      name={`account:${key}`}
                      inputMode="numeric"
                      pattern="[1-9][0-9]{3}"
                      maxLength={4}
                      size={6}
                      defaultValue={base.map[key]?.account ?? ''}
                    />
                  </td>
                  <td>
                    <select
                      name={`side:${key}`}
                      aria-label={`${label(key)} ${d.side}`}
                      defaultValue={base.map[key]?.side ?? 'debit'}
                    >
                      <option value="debit">{d.debit}</option>
                      <option value="credit">{d.credit}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      {!editable && <p>{d.readOnlyMap}</p>}
      {editable && !saved && (
        <Button disabled={action.busy || action.needsReload}>
          {action.busy
            ? intake.busy
            : action.locked
              ? intake.retry
              : d.publishMap}
        </Button>
      )}
      {saved && <p role="status">{d.mapPublished}</p>}
      {(invalid || action.error) && (
        <p role="alert">{action.error || intake.invalid}</p>
      )}
    </form>
  )
}

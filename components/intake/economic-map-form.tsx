'use client'
import { useState } from 'react'
import type { z } from 'zod'
import type { economicMap, EconomicMapBody } from '@/lib/engine/economic'
import type { Catalogue } from '@/extensions/economic/api'
import { accountingKeys } from '@/lib/engine/accounting'
import type { EconomicCopy } from '@/lib/accounting/economic-copy'
import { ReloadAction } from './reload-action'
import { useRouter } from '@/components/platform/use-working-router'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { Button } from '@/components/ui/button'
import { useEconomicAction } from './use-economic-action'

export function economicAmountLabel(key: string, d: EconomicCopy) {
  if (key in d.accounting.amountKeys)
    return d.accounting.amountKeys[key as keyof typeof d.accounting.amountKeys]
  const [, mode, amount] = key.split(':')
  const name = mode?.startsWith('consignment_fee')
    ? `${d.consignmentFees.title}${mode.endsWith('reversal') ? ` (${d.consignmentFees.status.reversed})` : ''}`
    : ((d.sales.vatModes as Record<string, string>)[mode] ?? mode)
  return `${name} · ${amount === 'grossOre' ? d.accounting.gross : amount === 'netOre' ? d.accounting.netOf : d.accounting.vatOf}`
}

export function EconomicMapForm({
  tenantId,
  current,
  editable,
  d,
}: {
  tenantId: string
  current: z.infer<typeof economicMap>
  editable: boolean
  d: EconomicCopy
}) {
  const t = d.economic,
    a = d.accounting,
    action = useEconomicAction(tenantId, t),
    router = useRouter()
  const [map, setMap] = useState<EconomicMapBody>(current.map)
  const [journal, setJournal] = useState(
    current.journalNumber?.toString() ?? '',
  )
  const [catalogue, setCatalogue] = useState<
    (Catalogue & { agreementNumber: number }) | null
  >(null)
  const [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false)
  useUnsavedChanges(dirty && !saved ? d.leaveUnsaved : null)
  const update = (key: string, value?: EconomicMapBody[string]) => {
    setMap((previous) => {
      const next = { ...previous }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
    setDirty(true)
    setSaved(false)
  }
  return (
    <form
      className="stack"
      aria-label={t.saveMap}
      onSubmit={async (event) => {
        event.preventDefault()
        if (!catalogue) return
        const result = await action.run({
          action: 'publishMap',
          requestId: crypto.randomUUID(),
          expectedCurrentId: current.id,
          agreementNumber: catalogue.agreementNumber,
          journalNumber: Number(journal),
          map,
        })
        if (result?.id) {
          setSaved(true)
          setDirty(false)
          router.refresh()
        }
      }}
    >
      <p>{t.mapHint}</p>
      <p>{t.feeHint}</p>
      <p>
        {a.mapVersion} {current.version} · {t.agreement}{' '}
        {current.agreementNumber ?? '—'}
      </p>
      {editable && (
        <Button
          type="button"
          variant="secondary"
          disabled={action.busy || action.locked}
          onClick={async () => {
            const value = await action.run({ action: 'catalogue' })
            if (
              value &&
              Array.isArray(value.accounts) &&
              Array.isArray(value.journals) &&
              Array.isArray(value.vatAccounts) &&
              typeof value.agreementNumber === 'number'
            )
              setCatalogue(value as Catalogue & { agreementNumber: number })
          }}
        >
          {t.loadCatalogue}
        </Button>
      )}
      <label>
        {t.journal}
        <select
          value={journal}
          disabled={!editable || !catalogue || action.busy || action.locked}
          required
          onChange={(event) => {
            setJournal(event.target.value)
            setDirty(true)
            setSaved(false)
          }}
        >
          <option value="">{t.unselected}</option>
          {journal &&
            !catalogue?.journals.some(
              (row) => String(row.number) === journal,
            ) && <option value={journal}>{journal}</option>}
          {catalogue?.journals.map((row) => (
            <option
              key={row.number}
              value={row.number}
              disabled={
                row.isStandingJournal ||
                (row.allowedEntryType != null &&
                  ![0, 5].includes(row.allowedEntryType))
              }
            >
              {row.number} · {row.name}
            </option>
          ))}
        </select>
      </label>
      <div
        className="economy-scroll"
        role="group"
        tabIndex={0}
        aria-label={a.mapHeading}
      >
        <table className="economy-table">
          <thead>
            <tr>
              <th>{a.amount}</th>
              <th>
                {t.post} / {t.exclude}
              </th>
              <th>
                {a.account} / {t.exclusionReason}
              </th>
              <th>{a.side}</th>
              <th>{t.vatCode}</th>
            </tr>
          </thead>
          <tbody>
            {accountingKeys.map((key) => {
              const entry = map[key],
                posted = entry && 'account' in entry ? entry : null
              const label = economicAmountLabel(key, d),
                disabled =
                  !editable || !catalogue || action.busy || action.locked
              return (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>
                    <select
                      aria-label={`${label} · ${t.post}`}
                      disabled={disabled}
                      value={!entry ? '' : posted ? 'post' : 'exclude'}
                      onChange={(event) =>
                        update(
                          key,
                          event.target.value === 'post'
                            ? { account: '', side: 'debit', vatCode: '' }
                            : event.target.value === 'exclude'
                              ? { excludeReason: '' }
                              : undefined,
                        )
                      }
                    >
                      <option value="">{t.unselected}</option>
                      <option value="post">{t.post}</option>
                      {!key.startsWith('mode:consignment_fee') && (
                        <option value="exclude">{t.exclude}</option>
                      )}
                    </select>
                  </td>
                  <td>
                    {posted ? (
                      <select
                        aria-label={`${label} · ${a.account}`}
                        disabled={disabled}
                        required
                        value={posted.account}
                        onChange={(event) =>
                          update(key, {
                            ...posted,
                            account: event.target.value,
                          })
                        }
                      >
                        <option value="">{t.unselected}</option>
                        {posted.account &&
                          !catalogue?.accounts.some(
                            (row) =>
                              String(row.accountNumber) === posted.account,
                          ) && (
                            <option value={posted.account}>
                              {posted.account}
                            </option>
                          )}
                        {catalogue?.accounts.map((row) => (
                          <option
                            key={row.accountNumber}
                            value={row.accountNumber}
                            disabled={
                              row.barred ||
                              row.blockDirectEntries ||
                              !!row.contraAccount ||
                              !['profitAndLoss', 'status'].includes(
                                row.accountType,
                              )
                            }
                          >
                            {row.accountNumber} · {row.name}
                          </option>
                        ))}
                      </select>
                    ) : entry && 'excludeReason' in entry ? (
                      <input
                        aria-label={`${label} · ${t.exclusionReason}`}
                        required
                        maxLength={500}
                        disabled={disabled}
                        value={entry.excludeReason}
                        onChange={(event) =>
                          update(key, { excludeReason: event.target.value })
                        }
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {posted && (
                      <select
                        aria-label={`${label} · ${a.side}`}
                        disabled={disabled}
                        value={posted.side}
                        onChange={(event) =>
                          update(key, {
                            ...posted,
                            side: event.target.value as 'debit' | 'credit',
                          })
                        }
                      >
                        <option value="debit">{a.debit}</option>
                        <option value="credit">{a.credit}</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {posted && (
                      <select
                        aria-label={`${label} · ${t.vatCode}`}
                        required
                        disabled={disabled}
                        value={posted.vatCode}
                        onChange={(event) =>
                          update(key, {
                            ...posted,
                            vatCode: event.target.value,
                          })
                        }
                      >
                        <option value="">{t.unselected}</option>
                        {posted.vatCode &&
                          !catalogue?.vatAccounts.some(
                            (row) => row.vatCode === posted.vatCode,
                          ) && (
                            <option value={posted.vatCode}>
                              {posted.vatCode}
                            </option>
                          )}
                        {catalogue?.vatAccounts.map((row) => (
                          <option
                            key={row.vatCode}
                            value={row.vatCode}
                            disabled={row.barred || row.ratePercentage !== 0}
                          >
                            {row.vatCode} · {row.name} ({row.ratePercentage}%)
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {action.error && <p role="alert">{action.error}</p>}
      {action.locked && <ReloadAction label={d.reload} />}
      {saved && <p role="status">{t.saved}</p>}
      {editable && (
        <Button disabled={!catalogue || !dirty || action.busy || action.locked}>
          {t.saveMap}
        </Button>
      )}
    </form>
  )
}

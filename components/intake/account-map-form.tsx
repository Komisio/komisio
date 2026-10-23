'use client'
import { useRef, useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { AccountingAssistant } from './accounting-assistant'
import type { RestoredAccountingDraft } from '@/lib/engine/accounting-assistance'
import {
  basSource,
  type AccountSuggestion,
} from '@/lib/accounting/account-suggestions'
import type { Dictionary, Locale } from '@/lib/i18n'
import {
  accountingKeys,
  accountingMapBody,
  type AccountingMapBody,
} from '@/lib/engine/accounting'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'

/** The tenant's account map: one account and side per day-close amount, or none. */
export function AccountMapForm({
  tenantId,
  current,
  editable,
  d,
  vatModes,
  intake,
  leaveUnsaved,
  locale,
  aiDraft,
}: {
  tenantId: string
  current: { id: string | null; version: number; map: AccountingMapBody }
  editable: boolean
  d: Dictionary['accounting']
  vatModes: Record<string, string>
  intake: Dictionary['intake']
  leaveUnsaved: string
  locale: Locale
  aiDraft: RestoredAccountingDraft | null
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const [base] = useState(current)
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [suggestion, setSuggestion] = useState<AccountSuggestion | null>(null)
  const [applied, setApplied] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const { ready, dirty, checkDirty } = useFormDirty(formRef)
  useUnsavedChanges(
    editable && !saved && (dirty || action.locked || aiBusy || applied)
      ? leaveUnsaved
      : null,
  )
  const label = (key: string) => {
    if (key in d.amountKeys)
      return d.amountKeys[key as keyof typeof d.amountKeys]
    if (key.startsWith('mode:')) {
      const [, mode, amount] = key.split(':')
      return `${vatModes[mode] ?? mode} · ${amount === 'grossOre' ? d.gross : amount === 'netOre' ? d.netOf : d.vatOf}`
    }
    return d.amountKeys[key as keyof typeof d.amountKeys] ?? key
  }
  function applySuggestion(value: AccountSuggestion) {
    const form = formRef.current
    if (!form) return
    const appliedRows: AccountSuggestion['rows'] = []
    for (const row of value.rows) {
      const method = row.key.startsWith('payment:')
        ? row.key.split(':')[1]
        : null
      const exclusion = method
        ? form.elements.namedItem(`exclude:${method}`)
        : null
      if (exclusion instanceof HTMLInputElement && exclusion.value.trim())
        continue
      const account = form.elements.namedItem('account:' + row.key)
      const side = form.elements.namedItem('side:' + row.key)
      if (
        account instanceof HTMLInputElement &&
        side instanceof HTMLSelectElement &&
        !account.value.trim()
      ) {
        account.value = row.account
        side.value = row.side
        appliedRows.push(row)
      }
    }
    setSuggestion({ ...value, rows: appliedRows })
    setApplied(appliedRows.length > 0)
    checkDirty()
  }
  return (
    <form
      ref={formRef}
      onChange={(event) => {
        const target = event.target
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement
        ) {
          const key = target.name.replace(/^(account|side):/, '')
          setSuggestion((previous) =>
            previous
              ? {
                  ...previous,
                  rows: previous.rows.filter((row) => row.key !== key),
                }
              : null,
          )
        }
        checkDirty()
      }}
      onSubmit={async (e) => {
        e.preventDefault()
        if (!ready || !editable || action.busy || aiBusy || action.needsReload)
          return
        if (action.locked) {
          if (await action.run({})) {
            setSaved(true)
            router.refresh()
          }
          return
        }
        const f = new FormData(e.currentTarget)
        const map: Record<
          string,
          { account?: string; side?: string; excludeReason?: string }
        > = {}
        for (const key of accountingKeys) {
          const account = String(f.get(`account:${key}`) ?? '').trim()
          if (account)
            map[key] = {
              account,
              side: String(f.get(`side:${key}`) ?? 'debit'),
            }
        }
        for (const method of ['card', 'cash', 'mobilepay', 'swish', 'other']) {
          const reason = String(f.get(`exclude:${method}`) ?? '').trim()
          if (reason) {
            map[`payment:${method}:grossOre`] = { excludeReason: reason }
            map[`payment:${method}:refundsOre`] = { excludeReason: reason }
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
      {editable && (
        <AccountingAssistant
          tenantId={tenantId}
          baseId={base.id}
          language={() => locale}
          apply={applySuggestion}
          d={d.ai}
          busyChanged={setAiBusy}
          initial={aiDraft}
          disabled={!ready || action.locked || saved || action.needsReload}
        />
      )}
      {suggestion && (
        <div className="accounting-ai-review" role="status">
          <p>{d.ai.review}</p>
          {suggestion.warnings.length > 0 && (
            <details>
              <summary>
                {d.ai.questions} ({suggestion.warnings.length})
              </summary>
              <ul>
                {suggestion.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <p className="muted">
        {base.id ? `${d.mapVersion} ${base.version}` : d.noMap}
      </p>
      <fieldset
        className="intake-fields"
        data-draft-readiness={!ready && editable ? '' : undefined}
        disabled={
          !ready ||
          !editable ||
          aiBusy ||
          action.locked ||
          saved ||
          action.needsReload
        }
      >
        <details>
          <summary>{d.paymentHeading}</summary>
          <p>{d.paymentExclusionHint}</p>
          {['card', 'cash', 'mobilepay', 'swish', 'other'].map((method) => (
            <label key={method}>
              {label(`payment:${method}:grossOre`)} · {d.paymentExclusionReason}
              <input
                name={`exclude:${method}`}
                maxLength={500}
                defaultValue={
                  base.map[`payment:${method}:grossOre`]?.excludeReason ?? ''
                }
              />
            </label>
          ))}
        </details>
        {(['basic', 'vat', 'fees'] as const).map((group) => {
          const keys = accountingKeys.filter((key) =>
            group === 'basic'
              ? !key.startsWith('mode:')
              : group === 'fees'
                ? key.startsWith('mode:consignment_fee')
                : key.startsWith('mode:') &&
                  !key.startsWith('mode:consignment_fee'),
          )
          return (
            <details
              key={group}
              className="account-map-group"
              open={
                group === 'basic' ||
                keys.some(
                  (key) =>
                    base.map[key] ||
                    suggestion?.rows.some((row) => row.key === key),
                )
              }
            >
              <summary>{d.groups[group]}</summary>
              <div className="account-map-fields">
                <table className="account-map-table">
                  <thead>
                    <tr>
                      <th scope="col">{d.amount}</th>
                      <th scope="col">{d.account}</th>
                      <th scope="col">{d.side}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key}>
                        <th scope="row">
                          <label htmlFor={`account:${key}`}>{label(key)}</label>
                          {suggestion?.rows.some((row) => row.key === key) && (
                            <details className="accounting-ai-reason">
                              <summary>{d.ai.reason}</summary>
                              <p>
                                {
                                  suggestion.rows.find((row) => row.key === key)
                                    ?.reason
                                }
                              </p>
                            </details>
                          )}
                        </th>
                        <td>
                          <span
                            className="account-map-mobile-label"
                            aria-hidden="true"
                          >
                            {d.account}
                          </span>
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
                          <span
                            className="account-map-mobile-label"
                            aria-hidden="true"
                          >
                            {d.side}
                          </span>
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
            </details>
          )
        })}
      </fieldset>
      <p className="accounting-map-note">
        {d.ai.hint}{' '}
        <a
          className="text-link"
          href={basSource}
          target="_blank"
          rel="noreferrer"
        >
          BAS 2026 ↗
        </a>
      </p>
      {!editable && <p>{d.readOnlyMap}</p>}
      {editable && !saved && (
        <Button
          disabled={!ready || action.busy || aiBusy || action.needsReload}
        >
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
      {action.needsReload && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {intake.reload}
        </Button>
      )}
    </form>
  )
}

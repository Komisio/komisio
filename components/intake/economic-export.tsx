'use client'
import { useEffect, useState } from 'react'
import type { z } from 'zod'
import type { EconomicSend, economicPreview } from '@/lib/engine/economic'
import type { ExportLine } from '@/extensions/economic/api'
import type { EconomicCopy } from '@/lib/accounting/economic-copy'
import { ReloadAction } from './reload-action'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { useRouter } from '@/components/platform/use-working-router'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { Button } from '@/components/ui/button'
import { useEconomicAction } from './use-economic-action'
import { economicAmountLabel } from './economic-map-form'
import { PayoutEvidence } from './payout-evidence'

export function EconomicLines({
  lines,
  excluded,
  d,
}: {
  lines: ExportLine[]
  excluded: Record<string, { amountOre: number; reason: string }>
  d: EconomicCopy
}) {
  const a = d.accounting,
    t = d.economic
  return (
    <>
      <div
        className="economy-scroll"
        role="group"
        tabIndex={0}
        aria-label={a.details}
      >
        <table className="economy-table">
          <thead>
            <tr>
              <th>{a.amount}</th>
              <th>{a.account}</th>
              <th>{a.debit}</th>
              <th>{a.credit}</th>
              <th>{t.vatCode}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key}>
                <th scope="row">{economicAmountLabel(line.key, d)}</th>
                <td>{line.account}</td>
                <td>
                  {line.side === 'debit'
                    ? `${formatSignedOre(line.amountOre)} DKK`
                    : '—'}
                </td>
                <td>
                  {line.side === 'credit'
                    ? `${formatSignedOre(line.amountOre)} DKK`
                    : '—'}
                </td>
                <td>{line.vatCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.keys(excluded).length > 0 && (
        <details>
          <summary>
            {t.exclude} ({Object.keys(excluded).length})
          </summary>
          <ul>
            {Object.entries(excluded).map(([key, value]) => (
              <li key={key}>
                {economicAmountLabel(key, d)} ·{' '}
                {formatSignedOre(value.amountOre)} DKK · {value.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

export function EconomicPrepare({
  tenantId,
  preview,
  editable,
  d,
}: {
  tenantId: string
  preview: z.infer<typeof economicPreview>
  editable: boolean
  d: EconomicCopy
}) {
  const action = useEconomicAction(tenantId, d.economic),
    router = useRouter()
  const [exportId, setExportId] = useState(preview.exportId)
  return (
    <div className="stack">
      <p>
        {d.accounting.mapVersion} {preview.mapVersion} · {d.economic.agreement}{' '}
        {preview.agreementNumber ?? '—'} · {d.economic.journal}{' '}
        {preview.journalNumber ?? '—'}
      </p>
      {preview.baselineExportId && <p>{d.economic.deltaHint}</p>}
      {preview.blockedReason && (
        <p role="status">
          {(d.economic.errors as Record<string, string>)[
            preview.blockedReason
          ] ?? d.economic.unknown}
        </p>
      )}
      <EconomicLines lines={preview.lines} excluded={preview.excluded} d={d} />
      <PayoutEvidence
        sources={preview.payoutSources}
        currency="DKK"
        d={d.accounting}
      />
      {preview.unmapped.length > 0 && (
        <p role="status">
          {d.economic.errors.ECONOMIC_MAP_INCOMPLETE}{' '}
          {preview.unmapped
            .map((key) => economicAmountLabel(key, d))
            .join(', ')}
        </p>
      )}
      {!preview.balanced && (
        <p role="status">
          {d.accounting.debitTotal}: {formatSignedOre(preview.debitOre)} DKK ·{' '}
          {d.accounting.credit}: {formatSignedOre(preview.creditOre)} DKK
        </p>
      )}
      {exportId ? (
        <Link
          className="text-link"
          href={`/intake/accounting?view=exports&destination=economic&export=${exportId}`}
        >
          {d.accounting.openExport}
        </Link>
      ) : (
        editable && (
          <Button
            type="button"
            disabled={
              action.busy ||
              action.locked ||
              !!preview.blockedReason ||
              !preview.mapId ||
              !preview.balanced ||
              preview.unmapped.length > 0 ||
              preview.lines.length === 0
            }
            onClick={async () => {
              const result = await action.run({
                action: 'export',
                dayCloseId: preview.dayCloseId,
                requestId: crypto.randomUUID(),
              })
              if (typeof result?.id === 'string') {
                setExportId(result.id)
                router.refresh()
              }
            }}
          >
            {d.economic.prepare}
          </Button>
        )
      )}
      {action.error && <p role="alert">{action.error}</p>}
      {action.locked && <ReloadAction label={d.reload} />}
    </div>
  )
}

export function EconomicDelivery({
  tenantId,
  exportId,
  initial,
  connected,
  editable,
  owner,
  d,
}: {
  tenantId: string
  exportId: string
  initial: EconomicSend | null
  connected: boolean
  editable: boolean
  owner: boolean
  d: EconomicCopy
}) {
  const t = d.economic,
    action = useEconomicAction(tenantId, t)
  const [send, setSend] = useState(initial)
  const [readyAfter, setReadyAfter] = useState<string | null>(null)
  const retryAfter = send?.retryAfter
  useEffect(() => {
    if (!retryAfter) return
    const timer = setTimeout(
      () => setReadyAfter(retryAfter),
      Math.max(0, Date.parse(retryAfter) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [retryAfter])
  const held =
    send?.status === 'pending' || send?.errorCode === 'ECONOMIC_OUTCOME_UNKNOWN'
  const retryBlocked = !!retryAfter && readyAfter !== retryAfter
  const message = (code: string) =>
    (t.errors as Record<string, string>)[code] ?? t.unknown
  // Old sends also stored response-schema failures as INVALID_INPUT. This is
  // presentation only: their immutable outcome and hold stay unchanged.
  const reason =
    held && send?.reason === 'INVALID_INPUT'
      ? 'ECONOMIC_UNVERIFIED_ENTRIES'
      : send?.reason
  return (
    <div className="stack">
      {send && (
        <p role="status">
          {send.status === 'sent'
            ? `${t.sent} ${send.voucherNumber}`
            : held
              ? send.status === 'pending'
                ? t.pending
                : reason === 'ECONOMIC_UNVERIFIED_ENTRIES' ||
                    reason === 'ECONOMIC_MULTIPLE_VOUCHERS'
                  ? message(reason)
                  : message('ECONOMIC_OUTCOME_UNKNOWN')
              : message(send.errorCode)}
          {!held && send.status !== 'sent' && reason && ` · ${message(reason)}`}
        </p>
      )}
      {send && (
        <p>
          {t.agreement} {send.agreementNumber} · {t.journal}{' '}
          {send.journalNumber} · K-{send.sendId}
        </p>
      )}
      {retryBlocked && <p>{send?.retryAfter}</p>}
      {editable && connected && !held && send?.status !== 'sent' && (
        <Button
          type="button"
          disabled={action.busy || action.locked || retryBlocked}
          onClick={async () => {
            const result = await action.run({
              action: 'send',
              exportId,
              requestId: crypto.randomUUID(),
            })
            if (
              result?.status === 'sent' ||
              result?.status === 'failed' ||
              result?.status === 'pending'
            ) {
              setSend(result as EconomicSend)
            }
          }}
        >
          {t.send}
        </Button>
      )}
      {owner && held && send && (
        <details>
          <summary>{d.fortnox.reconcileTitle}</summary>
          <p>{t.confirmHint}</p>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault()
              const fields = new FormData(event.currentTarget)
              const result = await action.run({
                action: 'confirm',
                sendId: send.sendId,
                journalNumber: Number(fields.get('journal')),
                voucherNumber: Number(fields.get('voucher')),
                evidence: fields.get('evidence'),
              })
              if (result?.status === 'sent') {
                setSend(result as EconomicSend)
              }
            }}
          >
            <label>
              {t.journal}
              <input
                name="journal"
                required
                type="number"
                min={1}
                max={2147483647}
                step={1}
              />
            </label>
            <label>
              {d.fortnox.reconcileNumber}
              <input
                name="voucher"
                required
                type="number"
                min={0}
                max={999999999}
                step={1}
              />
            </label>
            <label>
              {d.fortnox.reconcileEvidence}
              <textarea name="evidence" required maxLength={500} />
            </label>
            <Button disabled={action.busy || action.locked}>
              {d.fortnox.reconcileConfirm}
            </Button>
          </form>
        </details>
      )}
      {action.error && <p role="alert">{action.error}</p>}
      {action.locked && <ReloadAction label={d.reload} />}
    </div>
  )
}

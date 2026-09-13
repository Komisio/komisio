'use client'
import { useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import type { VoucherPreview } from '@/lib/engine/accounting'
import { useIntakeAction } from './use-intake-action'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { Button } from '@/components/ui/button'

/** Voucher preview for one day close and the export action; the file link follows the export. */
export function ExportDayClose({
  tenantId,
  preview,
  canExport,
  vatModes,
  d,
  intake,
}: {
  tenantId: string
  preview: VoucherPreview
  canExport: boolean
  vatModes: Record<string, string>
  d: Dictionary['accounting']
  intake: Dictionary['intake']
}) {
  const money = (ore: number) => `${formatSignedOre(ore)} SEK`
  const accountLabel = (key: string) => {
    if (key.startsWith('mode:')) {
      const [, mode, amount] = key.split(':')
      return `${vatModes[mode] ?? mode} · ${amount === 'netOre' ? d.netOf : d.vatOf}`
    }
    return d.amountKeys[key as keyof typeof d.amountKeys] ?? key
  }
  const action = useIntakeAction(intake)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [exportId, setExportId] = useState(preview.exportId)
  return (
    <div>
      <p>
        <strong>{d.voucherHeading}</strong> · {d.mapVersion}{' '}
        {preview.mapVersion} · {preview.balanced ? d.balanced : d.unbalanced} ·{' '}
        {d.debitTotal} {money(preview.debitOre)} · {d.creditTotal}{' '}
        {money(preview.creditOre)}
      </p>
      {preview.lines.length > 0 && (
        <ul>
          {preview.lines.map((l) => (
            <li key={l.key}>
              {l.account} · {l.side === 'debit' ? d.debit : d.credit} ·{' '}
              {money(l.amountOre)} · {accountLabel(l.key)}
            </li>
          ))}
        </ul>
      )}
      {preview.unmapped.length > 0 && (
        <p>
          <small>
            {d.unmappedAmounts}: {preview.unmapped.map(accountLabel).join(', ')}
          </small>
        </p>
      )}
      {exportId ? (
        <a className="text-link" href={`/api/accounting/${exportId}`}>
          {d.download}
        </a>
      ) : (
        canExport && (
          <Button
            type="button"
            variant="secondary"
            disabled={action.busy || !preview.balanced || action.needsReload}
            onClick={async () => {
              const id = await action.run({
                action: 'exportDayClose',
                tenantId,
                requestId,
                dayCloseId: preview.dayCloseId,
              })
              if (id) setExportId(id)
              else if (!action.locked) setRequestId(crypto.randomUUID())
            }}
          >
            {action.busy
              ? intake.busy
              : action.locked
                ? intake.retry
                : d.export}
          </Button>
        )
      )}
      {action.error && <p role="alert">{action.error}</p>}
    </div>
  )
}

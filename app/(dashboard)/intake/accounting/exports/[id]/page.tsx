import { notFound } from 'next/navigation'
import { z } from 'zod'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { requirePlatform } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readAccountingExport } from '@/lib/engine/accounting'
import { readFortnoxSends } from '@/lib/engine/fortnox-vouchers'
import { readFortnoxStatus } from '@/lib/engine/fortnox-connection'
import { readStoreCurrency, formatMoney } from '@/lib/engine/money'
import { FortnoxVoucherSend } from '@/components/intake/fortnox-voucher-send'
import { FortnoxReconcile } from '@/components/intake/fortnox-reconcile'

export const generateMetadata = () =>
  platformPageMetadata((d) => d.accounting.exportsHeading)

/** Exact immutable export, including sends older than the overview's bounded lists. */
export default async function ExportDetails({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.uuid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.accounting
  const item = await readAccountingExport(ctx.client, active.id, id.data)
  if (!item) notFound()
  const [sends, connection, currency] = await Promise.all([
    readFortnoxSends(ctx.client, active.id, id.data),
    readFortnoxStatus(ctx.client, active.id),
    readStoreCurrency(ctx.client, active.id),
  ])
  const send = sends.get(id.data)
  const date = new Intl.DateTimeFormat(intlLocale(ctx.locale), {
    dateStyle: 'long',
    timeZone: 'Europe/Stockholm',
  }).format(new Date(`${item.closeDate}T12:00:00Z`))
  return (
    <div className="accounting-page">
      <Link
        className="text-link"
        href={`/intake/accounting?view=reconciliation&from=${item.closeDate}&to=${item.closeDate}`}
      >
        {d.views.reconciliation}
      </Link>
      <div className="page-heading">
        <h1>{d.exportsHeading}</h1>
        <p>
          {date} · {d.version} {item.closeVersion}
        </p>
      </div>
      <section className="card intake-form" aria-label={d.exportsHeading}>
        <a className="btn btn-secondary" href={`/api/accounting/${item.id}`}>
          {d.download}
        </a>
        {(connection.connected || send) && (
          <div className="accounting-delivery">
            <h2>Fortnox</h2>
            <FortnoxVoucherSend
              key={`${item.id}-${send?.id}-${send?.status}`}
              tenantId={active.id}
              exportId={item.id}
              send={send ?? null}
              connected={connection.connected}
              canSend={['owner', 'admin'].includes(active.role)}
              d={all.fortnox}
            />
            {active.role === 'owner' &&
              send &&
              (send.status === 'pending' ||
                (send.status === 'failed' &&
                  send.error_code === 'FORTNOX_OUTCOME_UNKNOWN')) && (
                <FortnoxReconcile
                  tenantId={active.id}
                  send={send}
                  d={all.fortnox}
                />
              )}
          </div>
        )}
        <details className="accounting-breakdown">
          <summary>{d.details}</summary>
          <p>
            {d.debitTotal}: {formatMoney(item.debit_ore, currency)} ·{' '}
            {d.creditTotal}: {formatMoney(item.credit_ore, currency)}
          </p>
          <div className="stock-table-wrap">
            <table className="stock-table">
              <thead>
                <tr>
                  <th>{d.account}</th>
                  <th>{d.side}</th>
                  <th>{all.payouts.amount}</th>
                </tr>
              </thead>
              <tbody>
                {item.voucher.map((line, index) => (
                  <tr key={index}>
                    <th scope="row">{line.account}</th>
                    <td data-label={d.side}>{d[line.side]}</td>
                    <td data-label={all.payouts.amount}>
                      {formatMoney(line.amountOre, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  )
}

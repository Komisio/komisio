import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readZettlePurchase } from '@/lib/engine/zettle'
import { ZettleAction } from '@/components/intake/zettle-action'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
export default async function Receipt({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const ctx = await requirePlatform(),
    a = ctx.active!,
    d = dictionary(ctx.locale).zettle
  const r = await readZettlePurchase(ctx.client, a.id, id).catch((e: Error) => {
    if (e.message === 'ZETTLE_IMPORT_NOT_FOUND') notFound()
    throw e
  })
  const editable = a.role !== 'readonly' && !r.saleId && !r.blocked_reason
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{a.name}</div>
        <h1>{d.receipt}</h1>
        <p>{r.external_id}</p>
        <Link className="text-link" href="/intake/integrations">
          {d.back}
        </Link>
      </div>
      <section className="card intake-form">
        <p>
          {new Date(r.occurred_at).toLocaleString(ctx.locale, {
            timeZone: 'Europe/Stockholm',
          })}
        </p>
        <p>
          {d.total}: {formatSignedOre(r.amount_ore)} {r.currency}
        </p>
        <p>
          {d.revision}: {r.mappingRevision}
        </p>
        {r.blocked_reason && (
          <p role="status">
            {d.blocked}: {r.blocked_reason}. {d.unsupported}
          </p>
        )}
        {r.saleId && <p role="status">{d.recorded}</p>}
        {editable && <p>{d.matchHint}</p>}
        {r.rows.map((row) => (
          <section
            key={row.lineNo}
            aria-label={`${d.line} ${row.lineNo}`}
            className="intake-notice"
          >
            <h2>
              {d.line} {row.lineNo}: {row.description}
            </h2>
            <p>
              {formatSignedOre(row.priceOre)} {r.currency} ·{' '}
              {row.reference ?? '—'}
            </p>
            {row.itemId ? (
              <p>
                {d.matched}:{' '}
                <Link
                  className="text-link"
                  href={`/intake/items/${row.itemId}`}
                >
                  {row.itemId}
                </Link>
              </p>
            ) : (
              <p>{d.unmatched}</p>
            )}
            {editable && (
              <ZettleAction
                key={`${r.mappingRevision}-${row.lineNo}`}
                match
                command={{
                  action: 'resolve',
                  tenantId: a.id,
                  importId: id,
                  lineNo: row.lineNo,
                  mappingRevision: r.mappingRevision,
                  itemId: '',
                }}
                d={d}
                label={d.match}
              />
            )}
          </section>
        ))}
        {r.errorCode && !r.saleId && (
          <p role="status">
            {(d.errors as Record<string, string>)[r.errorCode] ?? d.held}
          </p>
        )}
        {editable && r.rows.every((row) => row.itemId) && (
          <ZettleAction
            command={{ action: 'retry', tenantId: a.id, importId: id }}
            d={d}
            label={d.retryReceipt}
          />
        )}
        <p>{d.approvalHint}</p>
      </section>
    </>
  )
}

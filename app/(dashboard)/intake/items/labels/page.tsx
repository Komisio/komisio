import { notFound } from 'next/navigation'
import Link from '@/components/platform/working-link'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { labelSheetQuery, readLabelSheet } from '@/lib/engine/label-sheets'
import { formatOre } from '@/lib/engine/items'
import './labels.css'

export default async function LabelSheets({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    d = dictionary(ctx.locale).labelSheets
  const p = await searchParams
  const selected = p.item
    ? (Array.isArray(p.item) ? p.item : [p.item]).join(',')
    : p.items
  const parsed = labelSheetQuery.safeParse({
    ...p,
    items: selected,
    tenant: ctx.active!.id,
  })
  const sheet = parsed.success
    ? await readLabelSheet(ctx.client, parsed.data).catch(() => null)
    : null
  return (
    <>
      <Link href="/intake/items">{d.back}</Link>
      <h1>{d.title}</h1>
      {!sheet || !parsed.success ? (
        <p role="alert">{d.error}</p>
      ) : !sheet.items.length ? (
        <p>{d.empty}</p>
      ) : (
        <>
          <form
            action="/api/items/labels"
            method="get"
            target="_blank"
            className="card"
          >
            <input type="hidden" name="tenant" value={ctx.active!.id} />
            {parsed.data.bag ? (
              <input type="hidden" name="bag" value={parsed.data.bag} />
            ) : (
              <input type="hidden" name="items" value={parsed.data.items} />
            )}
            <div className="label-sheet-controls">
              <label>
                {d.size}
                <select name="size" defaultValue={parsed.data.size}>
                  <option value="50x50">50 × 50 mm · 15 / A4</option>
                  <option value="57x32">57 × 32 mm · 24 / A4</option>
                </select>
              </label>
              <label>
                {d.copies}
                <input
                  name="copies"
                  type="number"
                  defaultValue="1"
                  min="1"
                  max={Math.min(10, Math.floor(400 / sheet.items.length))}
                  required
                  style={{ width: '7rem' }}
                />
              </label>
              <button className="btn">{d.preview}</button>
              <button className="btn btn-secondary" name="download" value="1">
                {d.download}
              </button>
            </div>
            <p>{d.hint}</p>
            <small>{d.limit}</small>
          </form>
          {sheet.skipped > 0 && (
            <p role="status">
              {d.skipped.replace('{count}', String(sheet.skipped))}
            </p>
          )}
          <div className="inventory-table-scroll">
            <table className="inventory-table">
              <tbody>
                {sheet.items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">{item.title || item.reference}</th>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.reference}</td>
                    <td>
                      {item.priceOre === null
                        ? '—'
                        : `${formatOre(item.priceOre)} ${item.currency}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

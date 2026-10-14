import { z } from 'zod'
import { notFound } from 'next/navigation'
import Link from '@/components/platform/working-link'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readClassifications,
  readAssortmentGroups,
} from '@/lib/engine/item-classification'
import { readAttributeVocabulary } from '@/lib/engine/attributes'
import { ItemClassificationEditor } from '@/components/intake/item-classification-editor'
import { readItemLabel } from '@/lib/engine/item-label'
export default async function Classify({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    all = dictionary(ctx.locale),
    p = await searchParams
  if (!['owner', 'admin', 'staff'].includes(ctx.active!.role)) notFound()
  const selected = z
    .array(z.guid())
    .min(1)
    .max(200)
    .safeParse(Array.isArray(p.item) ? p.item : p.item ? [p.item] : [])
  if (!selected.success) return <p role="alert">{all.labelSheets.error}</p>
  const [rows, groups, vocabulary] = await Promise.all([
    readClassifications(ctx.client, ctx.active!.id, selected.data),
    readAssortmentGroups(ctx.client, ctx.active!.id),
    readAttributeVocabulary(ctx.client, ctx.active!.id),
  ])
  const items: { id: string; version: number; title: string }[] = []
  for (let start = 0; start < rows.length; start += 10) {
    items.push(
      ...(await Promise.all(
        rows.slice(start, start + 10).map(async (row) => {
          const label = await readItemLabel(ctx.client, ctx.active!.id, row.id)
          return { ...row, title: label?.title || all.items.item }
        }),
      )),
    )
  }
  return (
    <>
      <Link href="/intake/items">{all.labelSheets.back}</Link>
      <h1>{all.itemWorkflow.bulk}</h1>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.title} · <small>I-{item.id.slice(0, 8).toUpperCase()}</small>
          </li>
        ))}
      </ul>
      <ItemClassificationEditor
        tenantId={ctx.active!.id}
        items={items}
        groups={groups}
        types={vocabulary.types}
        locale={ctx.locale}
        manage={['owner', 'admin'].includes(ctx.active!.role)}
        d={all}
      />
    </>
  )
}

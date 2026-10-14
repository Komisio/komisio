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
  return (
    <>
      <Link href="/intake/items">{all.labelSheets.back}</Link>
      <h1>{all.itemWorkflow.bulk}</h1>
      <p>
        {rows.length} ·{' '}
        {selected.data
          .map((id) => 'I-' + id.slice(0, 8).toUpperCase())
          .join(', ')}
      </p>
      <ItemClassificationEditor
        tenantId={ctx.active!.id}
        items={rows.map((r) => ({ ...r, title: '' }))}
        groups={groups}
        types={vocabulary.types}
        locale={ctx.locale}
        manage={['owner', 'admin'].includes(ctx.active!.role)}
        d={all}
      />
    </>
  )
}

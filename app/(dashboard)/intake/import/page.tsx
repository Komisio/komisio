import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { ImportSellers } from '@/components/intake/import-sellers'

/** Import wizard, first slice: sellers from a CSV file, staged for approval. */
export default async function Import() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.importer
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake/sellers">
          {all.nav.sellersList}
        </Link>
      </div>
      <p className="intake-notice">{d.notice}</p>
      {['owner', 'admin'].includes(active.role) ? (
        <ImportSellers tenantId={active.id} d={d} />
      ) : (
        <p>{d.ownerOnly}</p>
      )}
    </>
  )
}

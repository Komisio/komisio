import { notFound, redirect } from 'next/navigation'
import Link from '@/components/platform/working-link'
import { RegistrationReview } from '@/components/seller-registration/review'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreRegistrations } from '@/lib/engine/seller-registration'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import '@/components/seller-registration/registration.css'
export const generateMetadata = () =>
  platformPageMetadata((d) => d.selfRegistration.queue)
export default async function Registrations({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!
  if (!['owner', 'admin', 'staff'].includes(active.role)) notFound()
  const params = await searchParams
  const page =
    params.page && /^[1-9]\d{0,4}$/.test(params.page) ? Number(params.page) : 1
  if (page > 40001) notFound()
  const d = dictionary(ctx.locale).selfRegistration
  const data = await readStoreRegistrations(
    ctx.client,
    active.id,
    (page - 1) * 25,
  )
  const pages = Math.max(1, Math.ceil(data.total / 25))
  if (page > pages) redirect(`/intake/sellers/registrations?page=${pages}`)
  return (
    <div className="registration-page">
      <Link href="/intake/sellers">{d.back}</Link>
      <h1>{d.queue}</h1>
      <p>
        <Link href="/settings/seller-registration">{d.title}</Link>
      </p>
      {!data.total && (
        <section className="card">
          <p>{d.empty}</p>
        </section>
      )}
      {data.rows.map((entry) => (
        <RegistrationReview
          key={entry.id}
          tenantId={active.id}
          entry={entry}
          locale={ctx.locale}
          d={d}
        />
      ))}
      <nav className="actions" aria-label={d.queue}>
        {page > 1 && (
          <Link href={`/intake/sellers/registrations?page=${page - 1}`}>
            {d.previous}
          </Link>
        )}
        {page < pages && (
          <Link href={`/intake/sellers/registrations?page=${page + 1}`}>
            {d.next}
          </Link>
        )}
      </nav>
    </div>
  )
}

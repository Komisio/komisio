import { notFound } from 'next/navigation'
import Link from '@/components/platform/working-link'
import { requirePlatform } from '@/lib/platform/context'
import { isPlatformHost } from '@/lib/engine/plans'
import { readDeletionCases } from '@/lib/engine/account-deletion'
import { accountDeletionCopy } from '@/lib/platform/account-deletion-copy'
import { AccountDeletionCases } from '@/components/platform/account-deletion-cases'
import { platformPageMetadata } from '@/lib/platform/page-metadata'

export default async function AccountDeletions({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>
}) {
  const ctx = await requirePlatform(false)
  if (ctx.support || !(await isPlatformHost(ctx.client))) notFound()
  const raw = (await searchParams).offset ?? '0'
  const offset = /^\d{1,6}$/.test(raw) ? Number(raw) : 0
  if (offset > 100000) notFound()
  const result = await readDeletionCases(ctx.client, offset)
  const d = accountDeletionCopy(ctx.locale)
  return (
    <div className="workspace">
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
      </div>
      <AccountDeletionCases rows={result.rows} locale={ctx.locale} />
      <nav className="flex gap-4" aria-label={d.title}>
        {offset > 0 ? (
          <Link href={`?offset=${Math.max(0, offset - 50)}`}>{d.previous}</Link>
        ) : null}
        {offset + 50 < result.total ? (
          <Link href={`?offset=${offset + 50}`}>{d.next}</Link>
        ) : null}
      </nav>
    </div>
  )
}
export const generateMetadata = () =>
  platformPageMetadata((d) => d.plans.hostTitle)

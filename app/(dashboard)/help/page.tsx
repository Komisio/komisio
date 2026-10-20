import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { HelpSearch } from '@/components/help/help-search'

export default async function Help() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const d = dictionary(ctx.locale).helpCenter
  return (
    <>
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
      </div>
      <HelpSearch d={d} />
    </>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.helpCenter.title)

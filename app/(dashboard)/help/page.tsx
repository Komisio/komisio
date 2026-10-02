import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { helpTopics } from '@/lib/help/topics'

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
      <div className="help-index">
        {helpTopics.map((topic) => (
          <article className="card" key={topic}>
            <h2>
              <Link className="text-link" href={`/help/${topic}`}>
                {d.articles[topic].title}
              </Link>
            </h2>
            <p>{d.articles[topic].intro}</p>
          </article>
        ))}
      </div>
    </>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.helpCenter.title)

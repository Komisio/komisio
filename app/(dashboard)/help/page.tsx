import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { helpTopics } from '@/lib/help/topics'
import { ArrowUpRight } from 'lucide-react'

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
          <Link
            className="card help-topic"
            key={topic}
            href={`/help/${topic}`}
            aria-labelledby={`help-${topic}`}
          >
            <h2 id={`help-${topic}`}>
              {d.articles[topic].title}
              <ArrowUpRight size={20} aria-hidden="true" />
            </h2>
            <p>{d.articles[topic].intro}</p>
          </Link>
        ))}
      </div>
    </>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.helpCenter.title)

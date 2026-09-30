import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { isHelpTopic } from '@/lib/help/topics'
import { HelpArticle } from '@/components/help/article'

export default async function HelpPage({
  params,
}: {
  params: Promise<{ topic: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const { topic } = await params
  if (!isHelpTopic(topic)) notFound()
  const ctx = await requirePlatform()
  const d = dictionary(ctx.locale).helpCenter
  return (
    <>
      <div className="page-heading">
        <Link className="text-link" href="/help">
          {d.title}
        </Link>
        <h1>{d.articles[topic].title}</h1>
      </div>
      <article className="card help-page">
        <HelpArticle topic={topic} d={d} />
      </article>
    </>
  )
}

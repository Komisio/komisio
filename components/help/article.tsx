'use client'
import type { Dictionary } from '@/lib/i18n'
import type { HelpTopic } from '@/lib/help/topics'
import type { HelpNode } from '@/lib/help/content-types'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { useHelpContent } from './content-provider'
import { ArticleFeedback } from './article-feedback'

function Nodes({
  nodes,
  onNavigate,
}: {
  nodes: HelpNode[]
  onNavigate?: () => void
}) {
  return nodes.map((node, index) => {
    if (node.type === 'text') return node.value
    if (node.type === 'inlineCode') return <code key={index}>{node.value}</code>
    if (!('children' in node)) return null
    const children = <Nodes nodes={node.children} onNavigate={onNavigate} />
    switch (node.type) {
      case 'paragraph':
        return <p key={index}>{children}</p>
      case 'strong':
        return <strong key={index}>{children}</strong>
      case 'emphasis':
        return <em key={index}>{children}</em>
      case 'blockquote':
        return (
          <blockquote key={index} className="intake-notice">
            {children}
          </blockquote>
        )
      case 'heading':
        return node.depth === 2 ? (
          <h2 key={index}>{children}</h2>
        ) : (
          <h3 key={index}>{children}</h3>
        )
      case 'list':
        return node.ordered ? (
          <ol key={index} start={node.start}>
            {children}
          </ol>
        ) : (
          <ul key={index}>{children}</ul>
        )
      case 'listItem':
        return <li key={index}>{children}</li>
      case 'link':
        return node.url.startsWith('/') ? (
          <Link
            key={index}
            className="text-link"
            href={node.url}
            onNavigate={onNavigate}
          >
            {children}
          </Link>
        ) : (
          <a
            key={index}
            className="text-link"
            href={node.url}
            target="_blank"
            rel="noreferrer"
          >
            {children}
          </a>
        )
    }
  })
}
export function HelpArticle({
  topic,
  d,
  onNavigate,
}: {
  topic: HelpTopic
  d: Dictionary['helpCenter']
  onNavigate?: () => void
}) {
  const context = useHelpContent()
  const article = context?.articles[topic]
  if (!article) return null
  return (
    <div className="help-article">
      {article.fallback && <p className="intake-notice">{d.fallbackNote}</p>}
      {article.machineTranslated && (
        <p className="intake-notice">{d.machineTranslationNote}</p>
      )}
      <div
        lang={
          article.sourceLocale === 'dk'
            ? 'da'
            : article.sourceLocale === 'no'
              ? 'nb'
              : article.sourceLocale
        }
      >
        <Nodes nodes={article.body} onNavigate={onNavigate} />
        <nav className="stack" aria-label={d.taskLinks}>
          {article.taskLinks.map((link) => (
            <Link
              key={link.href}
              className="text-link"
              href={link.href}
              onNavigate={onNavigate}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <ArticleFeedback
        key={`${context?.tenantId}:${topic}`}
        topic={topic}
        d={d.feedback}
      />
    </div>
  )
}

import type { Dictionary } from '@/lib/i18n'
import type { HelpTopic } from '@/lib/help/topics'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'

export function HelpArticle({
  topic,
  d,
}: {
  topic: HelpTopic
  d: Dictionary['helpCenter']
}) {
  const article = d.articles[topic]
  return (
    <div className="help-article">
      <p>{article.intro}</p>
      <ol>
        {article.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="intake-notice">{article.notice}</p>
      <nav className="stack" aria-label={d.taskLinks}>
        <Link
          className="text-link"
          href={
            topic === 'fortnox-automation'
              ? '/intake/accounting?view=settings#fortnox-automation'
              : '/intake/accounting?view=settings'
          }
        >
          {d.settings}
        </Link>
        <Link className="text-link" href="/intake/accounting">
          {d.days}
        </Link>
        <Link
          className="text-link"
          href="/intake/accounting?view=reconciliation"
        >
          {d.reconciliation}
        </Link>
        {topic === 'fortnox-automation' && (
          <Link className="text-link" href="/help/fortnox-recovery">
            {d.articles['fortnox-recovery'].title}
          </Link>
        )}
      </nav>
      {topic === 'fortnox-connect' && (
        <p>
          <a
            className="text-link"
            href="https://support.fortnox.se/hantera-fortnox/integrationer/kop-av-integration"
            target="_blank"
            rel="noreferrer"
          >
            {d.providerHelp}
          </a>
        </p>
      )}
    </div>
  )
}

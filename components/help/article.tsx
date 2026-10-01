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
        {topic === 'receiving' ? (
          <>
            <Link className="text-link" href="/intake">
              {d.receiving}
            </Link>
            <Link className="text-link" href="/intake/flow">
              {d.storeFlow}
            </Link>
            <Link className="text-link" href="/help/labels">
              {d.articles.labels.title}
            </Link>
          </>
        ) : topic === 'labels' ? (
          <>
            <Link className="text-link" href="/intake/items">
              {d.items}
            </Link>
            <Link className="text-link" href="/intake/open">
              {d.openReference}
            </Link>
            <Link className="text-link" href="/settings?tab=printing">
              {d.printing}
            </Link>
            <Link className="text-link" href="/help/receiving">
              {d.articles.receiving.title}
            </Link>
          </>
        ) : (
          <>
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
          </>
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

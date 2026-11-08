'use client'

import { useId, useState } from 'react'
import {
  ArrowRight,
  CalendarCheck,
  ChevronDown,
  ClipboardList,
  Users,
  Wallet,
} from 'lucide-react'
import Link from './working-link'
import type { Dictionary } from '@/lib/i18n'

const icons = {
  registrations: Users,
  proposals: ClipboardList,
  days: CalendarCheck,
  payouts: Wallet,
}

export type DashboardFollowUp = {
  kind: keyof typeof icons
  title: string
  count: number | null
  countLabel: string
  detail?: string
  href: string
  action: string
}

export function DashboardFollowUps({
  items,
  ui,
}: {
  items: DashboardFollowUp[]
  ui: Dictionary['dashboard']
}) {
  const [showAll, setShowAll] = useState(false)
  const id = useId()
  const visible = items.filter((item) => showAll || item.count !== 0)
  return (
    <section
      className="dashboard-followup-section"
      aria-labelledby={`${id}-title`}
    >
      <div className="dashboard-section-heading">
        <h2 id={`${id}-title`}>{ui.followUp}</h2>
        {items.some((item) => item.count === 0) && (
          <button
            type="button"
            className="dashboard-show-all"
            aria-expanded={showAll}
            aria-controls={id}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? ui.showLess : ui.showAll}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div id={id} className="dashboard-followups">
        {visible.length === 0 && (
          <p className="dashboard-empty">{ui.nothingPending}</p>
        )}
        {visible.map(
          ({ kind, title, count, countLabel, detail, href, action }) => {
            const Icon = icons[kind]
            return (
              <Link
                key={kind}
                href={href}
                className="dashboard-followup"
                data-pending={count !== null && count > 0}
              >
                <Icon size={24} aria-hidden="true" />
                <span className="dashboard-row-copy">
                  <strong>
                    {title}
                    {kind !== 'days' && count !== null && (
                      <span className="dashboard-count">{countLabel}</span>
                    )}
                  </strong>
                  {(count === null || detail) && (
                    <span>{count === null ? ui.unavailable : detail}</span>
                  )}
                </span>
                <span className="dashboard-row-action">
                  {action}
                  <ArrowRight size={17} aria-hidden="true" />
                </span>
              </Link>
            )
          },
        )}
      </div>
    </section>
  )
}

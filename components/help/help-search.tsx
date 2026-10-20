'use client'
import { useId, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import Link from '@/components/platform/working-link'
import type { Dictionary } from '@/lib/i18n'
import { searchHelp } from '@/lib/help/search'
import { ContactSupport } from './contact-support'

export function HelpSearch({ d }: { d: Dictionary['helpCenter'] }) {
  const [query, setQuery] = useState('')
  const id = useId()
  const topics = searchHelp(d, query)
  return (
    <>
      <div className="help-search">
        <label htmlFor={id}>{d.search.label}</label>
        <input
          id={id}
          type="search"
          value={query}
          placeholder={d.search.placeholder}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p role="status">
          {topics.length
            ? d.search.count.replace('{count}', String(topics.length))
            : d.search.empty}
        </p>
      </div>
      <div className="help-index">
        {topics.map((topic) => (
          <Link
            prefetch={false}
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
      <ContactSupport d={d.support} />
    </>
  )
}

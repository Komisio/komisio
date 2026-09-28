'use client'

import { dictionary } from '../lib/i18n'
import { Button } from '../components/ui/button'
import { useDocumentLocale } from '../components/platform/locale-provider'

export default function ErrorPage({ retry }: { retry: () => void }) {
  const d = dictionary(useDocumentLocale())
  return (
    <main className="onboarding">
      <div className="card">
        <h1>{d.unexpected}</h1>
        <Button onClick={retry}>{d.retry}</Button>
      </div>
    </main>
  )
}

'use client'
import { dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
export default function ErrorPage({ reset }: { reset: () => void }) {
  const d = dictionary()
  return (
    <div className="card">
      <h1>{d.unexpected}</h1>
      <Button onClick={reset}>{d.retry}</Button>
    </div>
  )
}

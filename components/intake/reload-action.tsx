'use client'
import { Button } from '@/components/ui/button'

/** Re-read the page after an answered refusal made the current form stale. */
export function ReloadAction({ label }: { label: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => window.location.reload()}
    >
      {label}
    </Button>
  )
}

'use client'
import { Button } from '@/components/ui/button'
export function PrintLabel({
  label,
  variant = 'primary',
}: {
  label: string
  variant?: 'primary' | 'secondary'
}) {
  return (
    <Button variant={variant} onClick={() => window.print()}>
      {label}
    </Button>
  )
}

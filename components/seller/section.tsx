import type { ComponentProps } from 'react'

/** The same readable section surface across the seller workspace. */
export function SellerSection({
  className = '',
  ...props
}: ComponentProps<'section'>) {
  return <section {...props} className={`card seller-section ${className}`} />
}

import { NavigationLink as Link } from './navigation-warning'
export function Brand({
  light = false,
  href = '/',
  compact = false,
}: {
  light?: boolean
  href?: string
  /** Icon mark only, for the collapsed navigation rail. */
  compact?: boolean
}) {
  return (
    <Link
      href={href}
      className={`brand ${light ? 'brand-light' : ''}`}
      aria-label="Komisio"
    >
      <span className="brand-mark" aria-hidden="true">
        k
      </span>
      {compact ? null : (
        <span>
          komisio<span className="brand-dot">.</span>
        </span>
      )}
    </Link>
  )
}

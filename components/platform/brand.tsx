import Image from 'next/image'
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
      className={`brand ${light ? 'brand-light' : ''} ${compact ? 'brand-compact' : ''}`}
      aria-label="Komisio"
    >
      <Image
        className="brand-mark"
        src={
          compact
            ? '/brand/icon-small.svg'
            : light
              ? '/brand/mark-lime-on-dark.svg'
              : '/brand/mark-dark-on-light.svg'
        }
        width={compact ? 32 : 48}
        height={compact ? 32 : 48}
        alt=""
        aria-hidden="true"
        unoptimized
      />
      {compact ? null : <span>komisio</span>}
    </Link>
  )
}

import { NavigationLink as Link } from './navigation-warning'
export function Brand({
  light = false,
  href = '/',
}: {
  light?: boolean
  href?: string
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
      <span>
        komisio<span className="brand-dot">.</span>
      </span>
    </Link>
  )
}

import Link from 'next/link'
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
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

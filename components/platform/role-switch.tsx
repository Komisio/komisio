import Link from '@/components/platform/working-link'
import type { Dictionary } from '@/lib/i18n'
import './role-switch.css'

export function RoleSwitch({
  current,
  d,
}: {
  current: 'store' | 'seller'
  d: Dictionary
}) {
  return (
    <nav
      className="role-switch no-print"
      aria-label={d.sellerAccess.switchView}
    >
      <Link href="/" aria-current={current === 'store' ? 'page' : undefined}>
        {d.sellerAccess.store}
      </Link>
      <Link
        href="/seller"
        aria-current={current === 'seller' ? 'page' : undefined}
      >
        {d.sellerAccess.seller}
      </Link>
    </nav>
  )
}

import Link from 'next/link'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { buildNavigation } from '@/lib/platform/navigation'
import { isPlatformHost } from '@/lib/engine/plans'
import { NavIcon } from '@/components/platform/nav-icon'

/** Every page of the store in its groups; the mobile bar's "more". */
export default async function MenuPage() {
  const ctx = await requirePlatform()
  const d = dictionary(ctx.locale)
  const groups = buildNavigation(d, {
    intakeEnabled: process.env.KOMISIO_INTAKE_ENABLED === 'true',
    host: await isPlatformHost(ctx.client),
  })
  return (
    <>
      <div className="page-heading">
        <h1>{d.nav.more}</h1>
      </div>
      {groups.map((group, i) => (
        <section className="card intake-form" key={i}>
          {group.label && <h2>{group.label}</h2>}
          <nav className="menu-list" aria-label={group.label || d.home}>
            {group.links.map((link) => (
              <Link key={link.path} href={link.path} className="nav-link">
                <NavIcon name={link.icon} size={17} strokeWidth={1.7} />
                {link.label}
              </Link>
            ))}
          </nav>
        </section>
      ))}
      <p>
        <Link className="text-link" href="/account">
          {d.account}
        </Link>
      </p>
    </>
  )
}

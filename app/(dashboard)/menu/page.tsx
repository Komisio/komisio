import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import styles from './menu.module.css'
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
    <div className={styles.menu}>
      <div className={`page-heading ${styles.heading}`}>
        <h1>{d.nav.more}</h1>
        <Link href="/" className={styles.link}>
          <NavIcon name="House" size={17} strokeWidth={1.7} />
          <span>{d.home}</span>
        </Link>
      </div>
      <div className={styles.groups}>
        {groups.slice(1).map((group, i) => (
          <section className={styles.group} key={i}>
            {group.label && <h2>{group.label}</h2>}
            <nav className={styles.links} aria-label={group.label || d.home}>
              {group.links.map((link) => (
                <Link key={link.path} href={link.path} className={styles.link}>
                  <NavIcon name={link.icon} size={17} strokeWidth={1.7} />
                  <span>{link.label}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </nav>
          </section>
        ))}
      </div>
      <p className={styles.account}>
        <Link className={styles.link} href="/account">
          <NavIcon name="UserRound" size={17} strokeWidth={1.7} />
          <span>{d.account}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </p>
    </div>
  )
}

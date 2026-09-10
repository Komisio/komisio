'use client'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { House, Users, Settings2, UserRound, Plus, LogOut } from 'lucide-react'
import { Brand } from './brand'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { Tenant } from '@/lib/platform/types'
import { browserClient } from '@/lib/supabase/client'
import { useCommand } from './use-command'
import { Feedback } from './feedback'
export function Shell({
  children,
  d,
  tenants,
  active,
  email,
  name,
}: {
  children: React.ReactNode
  d: Dictionary
  tenants: Tenant[]
  active: Tenant
  email: string
  name: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const action = useCommand(d)
  const links = [
    { path: '/', label: d.home, icon: House },
    { path: '/members', label: d.members, icon: Users },
    { path: '/settings', label: d.tenant, icon: Settings2 },
    { path: '/account', label: d.account, icon: UserRound },
  ]
  async function select(value: string) {
    const result = await action.run({ action: 'select', tenantId: value })
    if (result) {
      router.push('/')
      router.refresh()
    }
  }
  async function signOut() {
    await browserClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }
  const picker = (mobile = false) => (
    <select
      className={mobile ? 'mobile-picker' : ''}
      aria-label={d.activeTenant}
      value={active.id}
      disabled={action.busy}
      onChange={(e) => select(e.target.value)}
    >
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  )
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="tenant-picker">
          <small>{d.activeTenant}</small>
          {picker()}
          <Link
            href="/onboarding"
            className="text-link row"
            style={{ fontSize: 11 }}
          >
            <Plus size={12} />
            {d.newTenant}
          </Link>
        </div>
        <div className="nav-label eyebrow">{d.platform}</div>
        <nav aria-label={d.platform}>
          {links.slice(0, 3).map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              href={path}
              className={`nav-link ${pathname === path ? 'active' : ''}`}
              aria-current={pathname === path ? 'page' : undefined}
            >
              <Icon size={17} strokeWidth={1.7} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p style={{ fontSize: 11, padding: '0 12px' }}>{d.help}</p>
          <Link href="/account" className="account-link row">
            <span className="avatar">
              {(name || email).slice(0, 2).toUpperCase()}
            </span>
            <span>
              <span className="account-label">
                {name || email.split('@')[0]}
              </span>
              <small style={{ display: 'block', fontSize: 10 }}>
                {d.roles[active.role]}
              </small>
            </span>
          </Link>
          <Button variant="ghost" onClick={signOut} className="full">
            <LogOut size={14} />
            {d.logout}
          </Button>
        </div>
      </aside>
      <header className="topbar">
        <Brand />
        <span className="breadcrumb">
          {active.name}
          <span style={{ padding: '0 12px' }}>/</span>
          {links.find((l) => l.path === pathname)?.label ?? d.home}
        </span>
        <div className="desktop-only row">
          <span className="badge">{d.roles[active.role]}</span>
          <span className="avatar">
            {(name || email).slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="mobile-only">{picker(true)}</div>
      </header>
      <main className="main">
        <Feedback error={action.error} />
        {children}
      </main>
      <nav className="mobile-nav" aria-label={d.platform}>
        {links.map(({ path, label, icon: Icon }) => (
          <Link
            key={path}
            href={path}
            className={`nav-link ${pathname === path ? 'active' : ''}`}
            aria-current={pathname === path ? 'page' : undefined}
          >
            <Icon size={19} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

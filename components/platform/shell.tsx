'use client'
import { useBusyState } from './work-activity'
import { usePathname } from 'next/navigation'
import { useRouter } from '@/components/platform/use-working-router'
import {
  NavigationLink as Link,
  useConfirmNavigation,
} from './navigation-warning'
import { NavIcon } from './nav-icon'
import {
  buildNavigation,
  currentLink,
  mobileNavigation,
  mobileCurrentPath,
} from '@/lib/platform/navigation'
import { Brand } from './brand'
import { Sidebar } from './sidebar'
import { intlLocale, type Dictionary, type Locale } from '@/lib/i18n'
import { LanguagePicker } from './language-picker'
import type { Tenant } from '@/lib/platform/types'
import { browserClient } from '@/lib/supabase/client'
import { useCommand } from './use-command'
import { Feedback } from './feedback'
import { HeaderHelp } from '@/components/help/header-help'
import { Suspense, useRef, useSyncExternalStore, type FocusEvent } from 'react'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false
export function Shell({
  children,
  d,
  locale,
  tenants,
  active,
  email,
  name,
  intakeEnabled = false,
  host = false,
  sidebarCollapsed = false,
}: {
  children: React.ReactNode
  d: Dictionary
  locale: Locale
  tenants: Tenant[]
  active: Tenant
  email: string
  name: string
  intakeEnabled?: boolean
  host?: boolean
  sidebarCollapsed?: boolean
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const pathname = usePathname()
  const router = useRouter()
  const action = useCommand(d)
  const [signingOut, setSigningOut] = useBusyState(false)
  const confirmNavigation = useConfirmNavigation()
  const groups = buildNavigation(d, { intakeEnabled, host })
  const mobile = mobileNavigation(d, intakeEnabled)
  const mobileActive = mobileCurrentPath(pathname, mobile)
  const current = currentLink(groups, pathname)
  const mobileNav = useRef<HTMLElement>(null)
  function revealFocusedControl(event: FocusEvent<HTMLElement>) {
    const target = event.target
    if (
      !target.matches(
        'a,button,input,select,textarea,summary,[tabindex="0"]',
      ) ||
      target.closest('dialog') ||
      (target instanceof HTMLAnchorElement && !target.matches(':focus-visible'))
    )
      return
    const focusedUrl = window.location.href
    // Native focus scrolling can reveal only a textarea's caret, leaving the
    // editor under the fixed menu. Measure after that scroll, not before it.
    requestAnimationFrame(() => {
      // A click can navigate to an anchor before this frame; never scroll back
      // to the old link after the browser has revealed the requested section.
      if (
        !target.isConnected ||
        document.activeElement !== target ||
        window.location.href !== focusedUrl
      )
        return
      const nav = mobileNav.current?.getBoundingClientRect()
      if (!nav?.height) return
      const bounds = target.getBoundingClientRect()
      if (bounds.bottom > nav.top || bounds.top < 0)
        target.scrollIntoView({ block: 'center', inline: 'nearest' })
    })
  }
  async function select(value: string) {
    if (!ready || action.busy || value === active.id || !confirmNavigation())
      return
    const result = await action.run({ action: 'select', tenantId: value })
    if (result) {
      router.push('/')
      router.refresh()
    }
  }
  async function signOut() {
    if (signingOut || !confirmNavigation()) return
    setSigningOut(true)
    try {
      await browserClient().auth.signOut()
      router.push('/login')
      router.refresh()
    } finally {
      setSigningOut(false)
    }
  }
  const picker = (mobile = false) => (
    <select
      className={mobile ? 'mobile-picker' : ''}
      aria-label={d.activeTenant}
      value={active.id}
      disabled={!ready || action.busy}
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
    <div className="app-shell" lang={intlLocale(locale)}>
      <a className="skip-link no-print" href="#main-content">
        {d.skipToContent}
      </a>
      <Sidebar
        d={d}
        tenants={tenants}
        active={active}
        email={email}
        name={name}
        intakeEnabled={intakeEnabled}
        host={host}
        collapsed={sidebarCollapsed}
        ready={ready}
        busy={action.busy}
        signingOut={signingOut}
        onSelect={select}
        onSignOut={signOut}
      />
      <header className="topbar">
        <Brand />
        <span className="breadcrumb">
          {active.name}
          <span style={{ padding: '0 12px' }}>/</span>
          {pathname === '/menu'
            ? d.nav.more
            : pathname === '/account'
              ? d.account
              : (current?.label ?? d.home)}
        </span>
        {intakeEnabled && (
          <form
            action="/intake/open"
            className="topbar-search desktop-only"
            role="search"
            aria-label={d.openByReference.title}
          >
            <input
              name="ref"
              placeholder={d.openByReference.hint}
              aria-label={d.openByReference.reference}
              maxLength={16}
              inputMode="text"
            />
          </form>
        )}
        <div className="topbar-tools">
          {intakeEnabled && (
            <Suspense
              fallback={
                <Link className="text-link" href="/help">
                  {d.helpCenter.title}
                </Link>
              }
            >
              <HeaderHelp tenantId={active.id} d={d.helpCenter} />
            </Suspense>
          )}
          <LanguagePicker locale={locale} label={d.language} />
          <div className="desktop-only row">
            <span className="badge">{d.roles[active.role]}</span>
            <span className="avatar">
              {(name || email).slice(0, 2).toUpperCase()}
            </span>
          </div>
        </div>
        <div className="mobile-only">{picker(true)}</div>
      </header>
      <main
        className="main"
        id="main-content"
        tabIndex={-1}
        onFocusCapture={revealFocusedControl}
      >
        <Feedback error={action.error} />
        {children}
      </main>
      <nav className="mobile-nav" aria-label={d.platform} ref={mobileNav}>
        {mobile.map(({ path, label, icon }) => (
          <Link
            key={path}
            href={path}
            className={`nav-link ${mobileActive === path ? 'active' : ''}`}
            aria-current={
              mobileActive === path
                ? pathname === path
                  ? 'page'
                  : 'location'
                : undefined
            }
          >
            <NavIcon name={icon} size={19} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

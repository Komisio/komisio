'use client'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { LogOut, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import { buildNavigation, isActivePath } from '@/lib/platform/navigation'
import {
  SIDEBAR_DESKTOP_QUERY,
  SIDEBAR_ID,
  commitSidebarToggle,
  isEditableShortcutTarget,
  isSidebarShortcut,
} from '@/lib/platform/sidebar-preference'
import type { Tenant } from '@/lib/platform/types'
import { Brand } from './brand'
import { NavIcon } from './nav-icon'
import { NavigationLink as Link } from './navigation-warning'

function RailTooltip({
  enabled,
  label,
  children,
}: {
  enabled: boolean
  label: string
  children: ReactNode
}) {
  const host = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)
  function show() {
    const current = host.current
    if (!enabled || !current) return
    const rect = current.getBoundingClientRect()
    setBox({
      top: rect.top + rect.height / 2,
      left: Math.min(rect.right + 12, window.innerWidth - 24),
    })
  }
  useEffect(() => {
    if (!box) return
    const dismiss = () => setBox(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [box])
  return (
    <span
      className="rail-tooltip-host"
      ref={host}
      onMouseEnter={show}
      onMouseLeave={() => setBox(null)}
      onFocus={show}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setBox(null)
      }}
    >
      {children}
      {enabled && box
        ? createPortal(
            <span
              role="tooltip"
              className="sidebar-tooltip"
              style={{ top: box.top, left: box.left }}
              aria-hidden="true"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}

function placeFlyout(button: HTMLElement, panel: HTMLElement) {
  const rect = button.getBoundingClientRect()
  const margin = 8
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  let left = rect.right + margin
  if (left + width > window.innerWidth - margin)
    left = Math.max(margin, rect.left - width - margin)
  let top = rect.top
  if (top + height > window.innerHeight - margin)
    top = Math.max(margin, window.innerHeight - height - margin)
  panel.style.left = `${left}px`
  panel.style.top = `${top}px`
}

export function Sidebar({
  d,
  tenants,
  active,
  email,
  name,
  intakeEnabled,
  host,
  collapsed: initialCollapsed,
  ready,
  busy,
  signingOut,
  onSelect,
  onSignOut,
}: {
  d: Dictionary
  tenants: Tenant[]
  active: Tenant
  email: string
  name: string
  intakeEnabled: boolean
  host: boolean
  collapsed: boolean
  ready: boolean
  busy: boolean
  signingOut: boolean
  onSelect: (tenantId: string) => void
  onSignOut: () => void
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [storeOpen, setStoreOpen] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const focusFrame = useRef<number | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const storeButtonRef = useRef<HTMLButtonElement>(null)
  const storePanelRef = useRef<HTMLDivElement>(null)
  const storeAnchor = useRef<{ top: number; left: number } | null>(null)
  const storePanelId = useId()
  const groups = buildNavigation(d, { intakeEnabled, host })
  const accountName = name || email.split('@')[0] || email
  const toggleLabel = collapsed ? d.nav.expandMenu : d.nav.collapseMenu
  const storeLabel = `${d.activeTenant}: ${active.name}`

  // Native backward tab scrolling can place a link underneath the sticky header.
  // Correct only this scroller, after the browser has finished moving focus.
  function revealFocusedControl(event: FocusEvent<HTMLElement>) {
    const target = event.target
    if (
      headerRef.current?.contains(target) ||
      target.closest('.sidebar-flyout')
    )
      return
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null
      const sidebar = sidebarRef.current
      const header = headerRef.current
      if (!sidebar || !header || document.activeElement !== target) return
      const overlap =
        header.getBoundingClientRect().bottom +
        8 -
        target.getBoundingClientRect().top
      if (overlap > 0) sidebar.scrollTop -= overlap
    })
  }

  useEffect(
    () => () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
    },
    [],
  )

  const applyToggle = useCallback(() => {
    const focused = document.activeElement
    if (
      focused instanceof HTMLElement &&
      focused !== toggleRef.current &&
      (sidebarRef.current?.contains(focused) ||
        storePanelRef.current?.contains(focused)) &&
      focused.closest('.tenant-picker, .sidebar-flyout, .sidebar-store')
    )
      toggleRef.current?.focus()
    const next = commitSidebarToggle(collapsed, (value) => {
      document.cookie = value
    })
    setStoreOpen(false)
    setCollapsed(next)
  }, [collapsed])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSidebarShortcut(event) || isEditableShortcutTarget(event.target))
        return
      if (!window.matchMedia(SIDEBAR_DESKTOP_QUERY).matches) return
      event.preventDefault()
      applyToggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyToggle])

  useEffect(() => {
    const desktop = window.matchMedia(SIDEBAR_DESKTOP_QUERY)
    function closeOnNarrow() {
      if (!desktop.matches) setStoreOpen(false)
    }
    desktop.addEventListener('change', closeOnNarrow)
    return () => desktop.removeEventListener('change', closeOnNarrow)
  }, [])

  useEffect(() => {
    if (!storeOpen) return
    const dismiss = () => setStoreOpen(false)
    function onScroll(event: Event) {
      // Scrolling within the popup does not move its anchor.
      if (
        event.target instanceof Node &&
        storePanelRef.current?.contains(event.target)
      )
        return
      const rect = storeButtonRef.current?.getBoundingClientRect()
      const anchor = storeAnchor.current
      if (
        !rect ||
        !anchor ||
        rect.top !== anchor.top ||
        rect.left !== anchor.left
      )
        dismiss()
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (storeButtonRef.current?.contains(target)) return
      if (storePanelRef.current?.contains(target)) return
      setStoreOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setStoreOpen(false)
      storeButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [storeOpen])

  useLayoutEffect(() => {
    const panel = storePanelRef.current
    const button = storeButtonRef.current
    if (!panel) return
    if (!storeOpen || !button) {
      if (panel.matches(':popover-open')) panel.hidePopover()
      return
    }
    if (!panel.matches(':popover-open')) panel.showPopover()
    placeFlyout(button, panel)
    const { top, left } = button.getBoundingClientRect()
    storeAnchor.current = { top, left }
    const select = panel.querySelector('select')
    if (select instanceof HTMLElement) select.focus({ preventScroll: true })
    return () => {
      if (panel.isConnected && panel.matches(':popover-open'))
        panel.hidePopover()
    }
  }, [storeOpen, collapsed])

  const storeControls = (
    <>
      <small>{d.activeTenant}</small>
      <select
        aria-label={d.activeTenant}
        value={active.id}
        disabled={!ready || busy}
        onChange={(event) => onSelect(event.target.value)}
      >
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}
          </option>
        ))}
      </select>
      <Link
        href="/onboarding"
        className="text-link row"
        style={{ fontSize: 12 }}
      >
        <Plus size={12} aria-hidden="true" />
        {d.newTenant}
      </Link>
    </>
  )

  return (
    <aside
      id={SIDEBAR_ID}
      className={collapsed ? 'sidebar sidebar-collapsed' : 'sidebar'}
      ref={sidebarRef}
      onFocusCapture={revealFocusedControl}
    >
      <div className="sidebar-header" ref={headerRef}>
        <Brand compact={collapsed} />
        <RailTooltip
          enabled={collapsed}
          label={`${toggleLabel} (${d.nav.menuShortcut})`}
        >
          <button
            type="button"
            className="sidebar-toggle"
            ref={toggleRef}
            aria-expanded={!collapsed}
            aria-controls={SIDEBAR_ID}
            aria-keyshortcuts="Control+b Meta+b"
            title={collapsed ? undefined : d.nav.menuShortcut}
            onClick={applyToggle}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} aria-hidden="true" />
            )}
            <span className="nav-text">{toggleLabel}</span>
          </button>
        </RailTooltip>
      </div>
      <div className="tenant-picker">
        {collapsed ? (
          <>
            <RailTooltip enabled={!storeOpen} label={storeLabel}>
              <button
                type="button"
                className="sidebar-store"
                ref={storeButtonRef}
                aria-expanded={storeOpen}
                aria-controls={storePanelId}
                aria-haspopup="true"
                aria-label={storeLabel}
                onClick={() => setStoreOpen((open) => !open)}
              >
                <NavIcon name="Building2" size={16} aria-hidden="true" />
              </button>
            </RailTooltip>
            <div
              id={storePanelId}
              popover="manual"
              className="sidebar-flyout"
              role="region"
              aria-label={d.activeTenant}
              ref={storePanelRef}
            >
              {storeControls}
            </div>
          </>
        ) : (
          storeControls
        )}
      </div>
      <nav aria-label={d.platform} className="sidebar-nav">
        {groups.map((group) => (
          <div key={group.label || 'home'} className="nav-group">
            {group.label ? (
              <div className="nav-label eyebrow">{group.label}</div>
            ) : null}
            {group.links.map(({ path, label, icon }) => {
              const current = isActivePath(pathname, path)
              return (
                <RailTooltip key={path} enabled={collapsed} label={label}>
                  <Link
                    href={path}
                    className={`nav-link ${current ? 'active' : ''}`}
                    aria-current={current ? 'page' : undefined}
                  >
                    <NavIcon
                      name={icon}
                      size={16}
                      strokeWidth={1.7}
                      aria-hidden="true"
                    />
                    <span className="nav-text">{label}</span>
                  </Link>
                </RailTooltip>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <p className="sidebar-help">{d.help}</p>
        <RailTooltip
          enabled={collapsed}
          label={`${accountName} · ${d.roles[active.role]}`}
        >
          <Link href="/account" className="account-link row">
            <span className="avatar">
              {(name || email).slice(0, 2).toUpperCase()}
            </span>
            <span className="nav-text">
              <span className="account-label">{accountName}</span>
              <small style={{ display: 'block', fontSize: 12 }}>
                {d.roles[active.role]}
              </small>
            </span>
          </Link>
        </RailTooltip>
        <RailTooltip enabled={collapsed} label={d.logout}>
          <Button
            type="button"
            variant="ghost"
            onClick={onSignOut}
            className="sidebar-logout full"
            disabled={signingOut}
          >
            <LogOut size={14} aria-hidden="true" />
            <span className="nav-text">{d.logout}</span>
          </Button>
        </RailTooltip>
      </div>
    </aside>
  )
}

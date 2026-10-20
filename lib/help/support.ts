import { z } from 'zod'
import { isLocale, type Dictionary } from '../i18n'
import { supportRoutes } from './support-routes'

export function supportConfig(env: Record<string, string | undefined>) {
  const candidate = env.KOMISIO_SUPPORT_EMAIL?.trim()
  const email =
    candidate &&
    candidate.length <= 254 &&
    z.email().safeParse(candidate).success
      ? candidate
      : 'support@komisio.com'
  let url: string | null = null
  try {
    const parsed = new URL(env.KOMISIO_SUPPORT_URL ?? '')
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password)
      url = parsed.href
  } catch {}
  return { email, url }
}

/** Only recognized route literals can leave the browser; dynamic segments never do. */
export function supportPage(
  pathname: string,
  view?: string | null,
  tab?: string | null,
) {
  const segments = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '').split('/')
  const path =
    supportRoutes.find((route) => {
      const template = route === '/' ? [''] : route.split('/')
      const actual = pathname === '/' ? [''] : segments
      return (
        template.length === actual.length &&
        template.every((part, i) =>
          part.startsWith('[') ? Boolean(actual[i]) : part === actual[i],
        )
      )
    }) ?? '/[page]'
  const query = new URLSearchParams()
  const views: Record<string, readonly string[]> = {
    '/intake/accounting': [
      'days',
      'exports',
      'reconciliation',
      'accounts',
      'settings',
      'planning',
    ],
    '/intake/submissions': ['all', 'pending', 'invited', 'registered'],
  }
  const tabs: Record<string, readonly string[]> = {
    '/settings': [
      'policy',
      'profile',
      'vocabulary',
      'store',
      'printing',
      'credits',
      'connectors',
    ],
  }
  if (view && views[path]?.includes(view)) query.set('view', view)
  if (tab && tabs[path]?.includes(tab)) query.set('tab', tab)
  return path + (query.size ? `?${query}` : '')
}

export type SupportContext = ReturnType<typeof supportConfig> & {
  storeName: string
  tenantId: string
  locale: string
  version: string
}

export function supportVersion(version: string, commit?: string) {
  return `${version}${commit && /^[a-f0-9]{7,40}$/i.test(commit) ? `+${commit.slice(0, 7)}` : ''}`
}

/** Explicit allowlist: no user, seller, token, arbitrary query or environment spreading. */
export function supportMail(
  context: SupportContext,
  page: { pathname: string; view?: string | null; tab?: string | null },
  d: Dictionary['helpCenter']['support'],
) {
  const clean = (value: string) =>
    Array.from(value.replace(/[\u0000-\u001f\u007f]/g, ' '))
      .map((char) => (/^[\ud800-\udfff]$/.test(char) ? '\ufffd' : char))
      .join('')
  const name = Array.from(clean(context.storeName)).slice(0, 1000)
  const tenant = z.uuid().safeParse(context.tenantId).success
    ? context.tenantId
    : ''
  const locale = isLocale(context.locale) ? context.locale : 'en'
  const version = /^[a-zA-Z0-9.+-]{1,48}$/.test(context.version)
    ? context.version
    : '—'
  const subject = d.subject
  const address = supportConfig({ KOMISIO_SUPPORT_EMAIL: context.email }).email
  const make = () => {
    const body = [
      d.store.replace('{store}', name.join('')),
      d.tenant.replace('{id}', tenant),
      d.page.replace('{page}', supportPage(page.pathname, page.view, page.tab)),
      d.locale.replace('{locale}', locale),
      d.version.replace('{version}', version),
      '',
      d.prompt,
    ].join('\n')
    const href = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    return { subject, body, href }
  }
  let mail = make()
  while (mail.href.length >= 2000 && name.length) {
    name.pop()
    mail = make()
  }
  return mail
}

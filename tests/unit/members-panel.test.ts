import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { MembersPanel } from '../../components/platform/members-panel'
import { dictionary, locales } from '../../lib/i18n'
import type { Member } from '../../lib/platform/types'

vi.mock('../../components/platform/use-command', () => ({
  useCommand: () => ({ busy: false, error: '', success: '', run: vi.fn() }),
}))

function member(
  name: string | null,
  role = 'staff',
  email: string | null = null,
) {
  return {
    user_id: 'synthetic-member',
    display_name: name,
    email,
    role,
    created_at: '2026-10-20T10:00:00Z',
  } as Member
}

function render(entry: Member, locale: (typeof locales)[number] = 'en') {
  return renderToStaticMarkup(
    createElement(MembersPanel, {
      d: dictionary(locale),
      locale,
      invitationLocale: locale,
      tenant: {
        id: 'synthetic-store',
        name: 'Synthetic store',
        slug: 'test',
        role: 'owner',
      },
      members: [entry],
      invitations: [],
      userId: 'synthetic-owner',
    }),
  )
    .split('<tbody>')[1]
    .split('</tbody>')[0]
}

it.each(locales)(
  'renders nameless service identities in %s without management actions',
  (locale) => {
    const d = dictionary(locale)
    for (const role of ['device', 'automation'] as const) {
      for (const name of [null, '', '  ']) {
        const markup = render(member(name, role), locale)
        expect(markup).toContain(d.roles[role])
        expect(markup).not.toContain('<select')
        expect(markup).not.toContain('<button')
        expect(markup).not.toContain('synthetic-member')
      }
    }
  },
)

it('retains real names and escapes text in the directory and action labels', () => {
  const markup = render(member('Synthetic <Admin>'))
  expect(markup).toContain('Synthetic &lt;Admin&gt;')
  expect(markup).toContain('aria-label="Change role: Synthetic &lt;Admin&gt;"')
  expect(markup).toContain('<select')
})

it.each([null, '', '  '])(
  'uses an already-visible email when the human name is %j',
  (name) => {
    const markup = render(member(name, 'staff', 'synthetic@example.test'))
    expect(markup).toContain('aria-label="Change role: synthetic@example.test"')
  },
)

it.each(locales)(
  'uses a translated human fallback without inventing private identity in %s',
  (locale) => {
    const d = dictionary(locale)
    const markup = render(member(null), locale)
    expect(markup).toContain(d.unnamedMember)
    expect(markup).toContain(`${d.changeRole}: ${d.unnamedMember}`)
    expect(markup).not.toContain('synthetic-member')
    expect(markup).not.toContain('@')
  },
)

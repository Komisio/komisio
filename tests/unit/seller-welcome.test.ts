import { expect, it } from 'vitest'
import { renderSellerWelcome } from '../../lib/communications/welcome'
import { locales } from '../../lib/i18n'
import { factCommunicationId } from '../../lib/communications/dispatch'
import { sendSellerCommunicationCommand } from '../../lib/engine/communications'

it('renders activation links without recipient details in every supported language', () => {
  for (const locale of locales) {
    const result = renderSellerWelcome(
      locale,
      'Synthetic Store',
      'Synthetic Seller',
      'https://example.test/ignored',
    )
    expect(result.templateKey).toBe('seller.welcome')
    const url = new URL(result.body.match(/https:\/\/\S+/)![0])
    expect(url.origin).toBe('https://example.test')
    expect(url.pathname).toBe('/register')
    expect(url.searchParams.get('next')).toBe('/seller')
    expect(url.searchParams.get('locale')).toBe(locale)
    expect(result.body).not.toMatch(/\{(store|seller|url)\}/)
    expect(result.body).toContain('Synthetic Store')
  }
})
it('does not recursively interpolate untrusted names or accept unsafe link protocols', () => {
  expect(
    renderSellerWelcome(
      'sv',
      '{url}\nStore',
      '{seller}',
      'https://example.test',
    ).subject,
  ).toContain('{url} Store')
  expect(() =>
    renderSellerWelcome('sv', 'Store', 'Seller', 'javascript:alert(1)'),
  ).toThrow()
})
it('has a stable automatic identity and forbids custom welcome content', () => {
  const id = 'f0000000-0000-4000-8000-000000000001'
  expect(factCommunicationId('welcome', id)).toBe(
    factCommunicationId('welcome', id.toUpperCase()),
  )
  expect(factCommunicationId('welcome', id)).not.toBe(
    factCommunicationId('message', id),
  )
  const command = {
    tenantId: id,
    sellerId: id,
    requestId: id,
    kind: 'message',
    welcome: true,
  }
  expect(sendSellerCommunicationCommand.safeParse(command).success).toBe(true)
  expect(
    sendSellerCommunicationCommand.safeParse({ ...command, freeText: 'Custom' })
      .success,
  ).toBe(false)
})

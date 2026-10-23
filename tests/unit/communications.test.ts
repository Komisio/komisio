import { expect, it } from 'vitest'
import {
  renderSellerMessage,
  plainText,
} from '../../lib/communications/templates'
import { sendSellerCommunicationCommand } from '../../lib/engine/communications'
import { sendSellerEmail } from '../../lib/platform/seller-email'
import { dictionary, locales, intlLocale } from '../../lib/i18n'
import { communicationKind } from '../../lib/communications/templates'
import {
  emailLocale,
  emailTemplate,
  templatePlaceholders,
} from '../../lib/communications/locale'
import { emailDecimalAmount } from '../../lib/communications/amount'
import { renderInvitationEmail } from '../../lib/platform/invitation-email'
import { renderSellerWelcome } from '../../lib/communications/welcome'
import { renderSubmissionReply } from '../../lib/communications/submission-reply'

const facts = { storeName: 'Synthetic Store', sellerName: 'Anna', freeText: '' }

it.each(locales)(
  'has complete, placeholder-compatible seller and invitation copy in %s',
  (locale) => {
    const source = dictionary('en').communications.templates
    const target = dictionary(locale).communications.templates
    expect(target.footer.trim()).not.toBe('')
    expect(templatePlaceholders(target.footer)).toEqual(
      templatePlaceholders(source.footer),
    )
    for (const kind of communicationKind.options) {
      expect(Object.keys(target[kind]).sort()).toEqual(
        Object.keys(source[kind]).sort(),
      )
      for (const [key, text] of Object.entries(source[kind])) {
        const translated = (target[kind] as Record<string, string>)[key]
        expect(translated.trim(), `${locale}.${kind}.${key}`).not.toBe('')
        expect(templatePlaceholders(translated)).toEqual(
          templatePlaceholders(text),
        )
      }
      // Exercise absent and present optional facts, including each variant alone.
      for (const optional of [
        {},
        { itemLabel: 'Synthetic item' },
        { number: 3 },
        {
          amount: '1234.57',
          currency: 'EUR',
          date: '2026-10-20T22:30:00Z',
          itemLabel: 'Synthetic item',
          number: 3,
        },
      ]) {
        const rendered = renderSellerMessage(kind, locale, {
          ...facts,
          ...optional,
        })
        expect(rendered.locale).toBe(locale)
        expect(rendered.subject.length).toBeGreaterThan(0)
        expect(rendered.subject.length).toBeLessThanOrEqual(200)
        expect(rendered.body.trim()).not.toBe('')
        expect(rendered.subject + rendered.body).not.toMatch(/\{[^}]+\}/)
      }
    }
    for (const key of ['subject', 'body'] as const) {
      const text = dictionary(locale).communications.invitation[key]
      expect(text.trim()).not.toBe('')
      expect(templatePlaceholders(text)).toEqual(
        templatePlaceholders(dictionary('sv').communications.invitation[key]),
      )
    }
    const invitation = renderInvitationEmail(
      locale,
      'https://example.test/invite/synthetic',
    )
    expect(invitation.locale).toBe(locale)
    expect(invitation.text).toContain('https://example.test/invite/synthetic')
    expect(invitation.text + invitation.subject).not.toMatch(/\{[^}]+\}/)
    const extra = (code: typeof locale) => {
      const d = dictionary(code)
      return {
        welcomeSubject: d.communications.welcomeSubject,
        welcomeBody: d.communications.welcomeBody,
        activationBody: d.communications.activationBody,
        activationLabel: d.sellerActivation.confirm,
        activationNote: d.sellerActivation.emailNote,
        replySubject: d.submissions.replySubject,
        replyBody: d.submissions.replyBody,
      }
    }
    for (const [key, source] of Object.entries(extra('en'))) {
      const text = extra(locale)[key as keyof ReturnType<typeof extra>]
      expect(typeof text, `${locale}.${key}`).toBe('string')
      expect(text.trim(), `${locale}.${key}`).not.toBe('')
      expect(templatePlaceholders(text), `${locale}.${key}`).toEqual(
        templatePlaceholders(source),
      )
    }
    for (const branded of [false, true]) {
      const welcome = renderSellerWelcome(
        locale,
        facts.storeName,
        facts.sellerName,
        'https://example.test',
        branded,
      )
      expect(welcome.locale).toBe(locale)
      expect(welcome.subject + welcome.body).not.toMatch(/\{[^}]+\}/)
    }
    expect(
      renderSubmissionReply(
        locale,
        facts.storeName,
        'synthetic',
        'https://example.test',
      ).locale,
    ).toBe(locale)
  },
)

it.each(['dk', 'no', 'fi'] as const)(
  'formats payout and settlement amounts in %s without losing cents',
  (locale) => {
    for (const kind of ['payout_paid', 'statement_issued'] as const) {
      const result = renderSellerMessage(kind, locale, {
        ...facts,
        amount: '-1234.57',
        currency: 'EUR',
        number: 2,
        date: '2026-10-20T22:30:00Z',
      })
      expect(result.body).toContain(
        new Intl.NumberFormat(intlLocale(locale), {
          style: 'currency',
          currency: 'EUR',
        }).format(-1234.57),
      )
      if (kind === 'payout_paid')
        expect(result.body).toContain(
          new Date('2026-10-21').toLocaleDateString(intlLocale(locale), {
            timeZone: 'Europe/Stockholm',
          }),
        )
    }
  },
)

it('resolves seller, store, store default, then English; broken templates use English', () => {
  expect(emailLocale('fi', 'dk')).toBe('fi')
  expect(emailLocale('unsupported', 'dk')).toBe('dk')
  expect(emailLocale(undefined, 'unsupported')).toBe('en')
  expect(emailLocale(undefined, undefined, 'dk')).toBe('dk')
  expect(emailLocale('fi', 'no', 'dk')).toBe('fi')
  expect(emailLocale(undefined, 'no', 'dk')).toBe('no')
  const english = { subject: 'Hello {seller}', body: 'Amount: {amount}' }
  for (const bad of [
    undefined,
    { subject: 'Hej {seller}', body: '' },
    { subject: 'Hej {seller}', body: 'Belopp: {wrong}' },
  ]) {
    expect(
      emailTemplate('sv', (d) => (d === dictionary('en') ? english : bad)),
    ).toEqual({ locale: 'en', copy: english })
  }
  expect(renderSellerMessage('message', 'unknown', facts)).toEqual(
    renderSellerMessage('message', 'en', facts),
  )
})

it('preserves exact signed database minor units beyond floating point precision', () => {
  expect(emailDecimalAmount('900719925474099357')).toBe('9007199254740993.57')
  expect(emailDecimalAmount('-1')).toBe('-0.01')
  expect(emailDecimalAmount(0)).toBe('0.00')
  expect(() => emailDecimalAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow()
  expect(() => emailDecimalAmount('1.23')).toThrow()
  expect(
    renderSellerMessage('payout_paid', 'en', {
      ...facts,
      amount: emailDecimalAmount('900719925474099357'),
      currency: 'EUR',
    }).body,
  ).toContain('9,007,199,254,740,993.57')
})

it('falls back as a whole for incomplete welcome, activation and submission copy', () => {
  const d = dictionary('fi')
  const welcome = d.communications.welcomeBody
  const activation = d.sellerActivation.emailNote
  const submission = d.submissions.replyBody
  try {
    d.communications.welcomeBody = ''
    d.sellerActivation.emailNote = ''
    d.submissions.replyBody = 'Missing {unknown}'
    for (const branded of [false, true])
      expect(
        renderSellerWelcome(
          'fi',
          'Store',
          'Seller',
          'https://example.test',
          branded,
        ),
      ).toEqual(
        renderSellerWelcome(
          'en',
          'Store',
          'Seller',
          'https://example.test',
          branded,
        ),
      )
    expect(
      renderSubmissionReply('fi', 'Store', 'seller', 'https://example.test'),
    ).toEqual(
      renderSubmissionReply('en', 'Store', 'seller', 'https://example.test'),
    )
  } finally {
    d.communications.welcomeBody = welcome
    d.sellerActivation.emailNote = activation
    d.submissions.replyBody = submission
  }
})

it('renders versioned wording with localized plain-text facts', () => {
  const sv = renderSellerMessage('payout_paid', 'sv', {
    ...facts,
    amount: '150.00',
    date: '2026-09-13',
  })
  expect(sv.subject).toBe('Synthetic Store: utbetalning gjord')
  expect(sv.body).toContain('150,00\u00a0kr')
  expect(sv.body).toContain('2026-09-13')
  expect(sv.templateKey).toBe('payout_paid')
  expect(sv.templateVersion).toBe('v2')
  const en = renderSellerMessage('statement_issued', 'en', {
    ...facts,
    number: 3,
    amount: '135.00',
  })
  expect(en.subject).toBe('Synthetic Store: settlement statement 3')
  expect(en.body).toContain('Closing balance: SEK\u00a0135.00')
  expect(en.body).toContain('through Komisio')
})
it('keeps store names and free text as plain text and strips control characters', () => {
  const r = renderSellerMessage('message', 'en', {
    storeName: 'Evil <a href="x">Store</a>\u0007',
    sellerName: 'Anna\nBanana',
    freeText: 'Line one\r\n\r\n\r\n\r\nLine two\u0000',
  })
  expect(r.subject).toBe('Message from Evil <a href="x">Store</a>')
  expect(r.body).toContain('Hello Anna Banana,')
  expect(r.body).toContain('Line one\n\nLine two')
  expect(r.body).not.toContain('\u0000')
  expect(plainText('a\u0001b')).toBe('ab')
})
it('rejects unknown kinds, oversized free text and mismatched references', () => {
  expect(() => renderSellerMessage('newsletter', 'sv', facts)).toThrow()
  expect(() =>
    renderSellerMessage('message', 'sv', {
      ...facts,
      freeText: 'x'.repeat(1001),
    }),
  ).toThrow()
  const base = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
    sellerId: '33333333-3333-4333-8333-333333333333',
  }
  expect(
    sendSellerCommunicationCommand.parse({ ...base, kind: 'message' })
      .referenceId,
  ).toBe(null)
  expect(
    sendSellerCommunicationCommand.safeParse({
      ...base,
      kind: 'payout_paid',
      referenceId: null,
    }).success,
  ).toBe(false)
  expect(
    sendSellerCommunicationCommand.safeParse({
      ...base,
      kind: 'message',
      referenceId: base.sellerId,
    }).success,
  ).toBe(false)
})
it('never sends outside the pilot allowlist or without the transport switch', async () => {
  const input = {
    communicationId: 'c1',
    to: 'Seller@Example.test',
    subject: 's',
    text: 't',
  }
  expect(await sendSellerEmail(input, {})).toBe('manual')
  expect(
    await sendSellerEmail(input, {
      SELLER_EMAIL_DELIVERY: 'resend',
      SELLER_EMAIL_ALLOWLIST: 'other@example.test',
    }),
  ).toBe('restricted')
  expect(
    await sendSellerEmail(input, {
      INVITATION_EMAIL_DELIVERY: 'resend',
      INVITATION_EMAIL_ALLOWLIST: 'seller@example.test',
    }),
  ).toBe('unconfirmed')
})

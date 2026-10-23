import { expect, it } from 'vitest'
import { dictionary, locales } from '../../lib/i18n'
it.each(locales)(
  'provides localized setup and recovery guidance without obsolete pilot instructions in %s',
  (locale) => {
    const p = dictionary(locale).printing
    for (const text of Object.values(p.setup)) expect(text.trim()).not.toBe('')
    expect(p.setup.weblinkNeeds).toContain('Link-OS/ZPL')
    expect(p.setup.webFileHelp).toContain('Available Files')
    expect(p.setup.webFileHelp).toContain('Send To Printer')
    expect(p.setup.webFileHelp).toContain('komisio-zebra-setup.zpl')
    expect(p.setup.illustration).toBeTruthy()
    expect(p.weblink.managed.unknown).toBeTruthy()
    expect(JSON.stringify(Object.values(p.weblink))).not.toMatch(/pilot/i)
    expect(Object.keys(p).some((k) => /^(agentStep|deviceStep)/.test(k))).toBe(
      false,
    )
    expect(p.weblink).not.toHaveProperty('preparation')
    expect(p.weblink).not.toHaveProperty('pairHint')
  },
)

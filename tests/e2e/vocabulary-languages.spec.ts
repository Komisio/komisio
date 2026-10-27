import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary, Locale } from '../../lib/i18n'
import { readFileSync } from 'node:fs'

const examples: [Locale, string, string, string, string, string, string][] = [
  ['sv', 'Lampa', 'Sockel', 'Inbyggd LED', 'Tröja', 'Passform', 'Barn'],
  ['en', 'Lamp', 'Socket', 'Integrated LED', 'Sweater', 'Fit', "Children's"],
  ['no', 'Lampe', 'Sokkel', 'Integrert LED', 'Genser', 'Passform', 'Barn'],
  ['dk', 'Lampe', 'Fatning', 'Indbygget LED', 'Trøje', 'Pasform', 'Børn'],
  [
    'fi',
    'Valaisin',
    'Lampun kanta',
    'Kiinteä LED',
    'Neule',
    'Istuvuus',
    'Lasten',
  ],
  [
    'de',
    'Lampe',
    'Fassung',
    'Integrierte LED',
    'Pullover',
    'Passform',
    'Kinder',
  ],
  [
    'es',
    'Lámpara',
    'Casquillo',
    'LED integrado',
    'Jersey',
    'Corte',
    'Infantil',
  ],
  [
    'it',
    'Lampada',
    'Attacco',
    'LED integrato',
    'Maglione',
    'Vestibilità',
    'Bambino',
  ],
]

test('standard item questions and choices use every UI language on a phone', async ({
  page,
}, testInfo) => {
  const email = `vocabulary-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    // Legacy stores retain copied profiles after #680. Build that fixture
    // explicitly: new stores no longer contain hidden platform type copies.
    await f.db.query('reset role')
    const legacyTypes = (
      await f.db.query(`
        select t.slug,t.labels,
          (select jsonb_agg(jsonb_build_object('slug',a.attribute_slug,'sort',a.sort,'expected',a.expected))
           from item_type_attributes a where a.tenant_id is null and a.type_slug=t.slug) attributes
        from item_types t where t.tenant_id is null and t.slug in ('lamp','sweater')`)
    ).rows
    await f.db.query('set local role authenticated')
    await f.db.query(
      `
      select set_attribute_definition($1,slug,jsonb_build_object(
        'dataType',data_type,'unit',unit,'choices',choices,'labels',labels,'help',help,'active',true))
      from attribute_definitions where tenant_id=$1 and slug in ('fit','height_cm','socket','max_wattage','dimmable')`,
      [f.tenant],
    )
    for (const type of legacyTypes)
      await f.db.query('select set_item_type($1,$2,$3)', [
        f.tenant,
        type.slug,
        { labels: type.labels, active: true, attributes: type.attributes },
      ])
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    for (const [
      locale,
      lamp,
      socket,
      integrated,
      sweater,
      fit,
      child,
    ] of examples) {
      await test.step(locale, async () => {
        const d: Dictionary = JSON.parse(
          readFileSync(
            new URL('../../messages/' + locale + '.json', import.meta.url),
            'utf8',
          ),
        )
        await page.context().addCookies([
          {
            name: 'komisio-locale',
            value: locale,
            url: new URL(page.url()).origin,
          },
        ])
        await page.goto('/intake/quick')
        await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
        await expect(
          page.getByLabel(d.operations.fields.description, { exact: true }),
        ).toBeVisible()
        const type = page.getByLabel(d.quickIntake.itemType, { exact: true })
        await type.selectOption({ label: lamp })
        const socketInput = page.getByLabel(socket, { exact: true })
        await expect(socketInput).toBeVisible()
        await expect(
          socketInput.locator('option[value="integrated"]'),
        ).toHaveText(integrated)
        await socketInput.selectOption('e27')
        await expect(socketInput).toHaveValue('e27')
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        if (locale === 'fi' || locale === 'de')
          await page.screenshot({
            path: testInfo.outputPath(`vocabulary-${locale}-mobile.png`),
            fullPage: true,
            caret: 'initial',
          })
        await type.selectOption({ label: sweater })
        const fitInput = page.getByLabel(fit, { exact: true })
        await expect(fitInput).toBeVisible()
        await expect(fitInput.locator('option[value="childrens"]')).toHaveText(
          child,
        )
        await fitInput.selectOption('childrens')
        await expect(fitInput).toHaveValue('childrens')
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
      })
    }
  } finally {
    await f.close()
  }
})

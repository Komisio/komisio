import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('seller finds old owned items and pages without losing the account on mobile', async ({
  page,
}) => {
  const email = `seller-items-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic item owner',
        email,
        '',
      ])
    ).rows[0].id
    await f.db.query('select record_agreement_evidence($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      seller,
      f.agreement,
      'Synthetic agreement',
    ])
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        seller,
        '',
        f.agreement,
      ])
    ).rows[0].id
    async function item(title: string) {
      const draft = randomUUID(),
        id = randomUUID()
      await f.db.query(
        'select pg_temp.prepare_bag_reception($1,$2,$3,$4,0,$5,$6,$7)',
        [
          f.tenant,
          randomUUID(),
          bag,
          draft,
          title,
          'Furniture',
          'Private condition',
        ],
      )
      await f.db.query(
        "select accept_item($1,$2,'reception_review',$3,1,20000)",
        [f.tenant, id, draft],
      )
      return id
    }
    const old = await item('Distinctive old armchair')
    await f.item('Another sellers private vase')
    await f.commit()
    await f.asActor(f.actor, async () => {
      for (let n = 0; n < 202; n++) await item('Synthetic furniture ' + n)
      const legacy = (
        await f.db.query('select my_items($1,$2) data', [f.tenant, seller])
      ).rows[0].data
      expect(legacy.items).toHaveLength(200)
      expect(legacy.items.some((i: { id: string }) => i.id === old)).toBe(false)
    })
    const writes: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/seller/'))
        writes.push(r.url())
    })
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/seller?seller=' + seller + '#portal-items')
    const section = page.getByRole('region', {
      name: d.sellerPortal.items,
      exact: true,
    })
    const rows = section.locator('tbody tr')
    await expect(rows).toHaveCount(25)
    await expect(section.getByText('Visar 1–25 av 203 varor')).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const nextBounds = await section
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .first()
      .boundingBox()
    expect(nextBounds?.height).toBeGreaterThanOrEqual(44)
    await page.screenshot({
      path: test.info().outputPath('seller-item-pages-mobile.png'),
      caret: 'initial',
    })
    const first = await rows.locator('td:first-child small').allTextContents()
    await section
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .first()
      .click()
    await expect(page).toHaveURL(/page=2#portal-items$/)
    await expect(section.getByText('Visar 26–50 av 203 varor')).toBeVisible()
    const second = await rows.locator('td:first-child small').allTextContents()
    expect(second.some((id) => first.includes(id))).toBe(false)
    await expect(section).toBeInViewport()
    await page.goBack()
    await expect(section.getByText('Visar 1–25 av 203 varor')).toBeVisible()
    const search = section.getByRole('search'),
      input = search.getByLabel(d.items.search, { exact: true })
    await input.fill('old ARMCHAIR')
    await search
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Distinctive old armchair')
    await expect(page).toHaveURL(new RegExp('seller=' + seller))
    await expect(input).toHaveValue('old ARMCHAIR')
    await expect(section.getByText('Another sellers private vase')).toHaveCount(
      0,
    )
    await expect(section.getByText('Private condition')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath('seller-item-search-mobile.png'),
      caret: 'initial',
    })
    await search
      .getByRole('link', { name: d.items.clearFilters, exact: true })
      .click()
    await expect(input).toHaveValue('')
    await expect(rows).toHaveCount(25)
    await input.fill('I-' + old.slice(0, 8).toUpperCase())
    await search
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Distinctive old armchair')
    await input.fill('%')
    await search
      .getByRole('button', { name: d.items.searchButton, exact: true })
      .click()
    await expect(
      section.getByText(d.items.noMatches, { exact: true }),
    ).toBeVisible()
    await page.goto('/seller?seller=' + seller + '&page=999#portal-items')
    await expect(page).toHaveURL(/page=9#portal-items$/)
    await expect(rows).toHaveCount(3)
    await expect(section.getByText('Visar 201–203 av 203 varor')).toBeVisible()
    const tags = {
      sv: 'sv-SE',
      en: 'en-GB',
      no: 'nb-NO',
      dk: 'da-DK',
      fi: 'fi-FI',
      de: 'de-DE',
      es: 'es-ES',
      it: 'it-IT',
    }
    for (const [locale, tag] of Object.entries(tags)) {
      await test.step(`Readable item in ${locale}`, async () => {
        const labels: Dictionary = JSON.parse(
          readFileSync(
            new URL(`../../messages/${locale}.json`, import.meta.url),
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
        await page.goto(`/seller?seller=${seller}&q=old+armchair#portal-items`)
        // The same URL with a fragment can be a same-document navigation.
        await page.reload()
        const table = page.getByRole('table', {
          name: labels.sellerPortal.items,
          exact: true,
        })
        await expect(table.locator('tbody tr')).toHaveCount(1)
        await expect(
          table.getByText('Distinctive old armchair', { exact: true }),
        ).toBeVisible()
        await expect(
          table.getByText('I-' + old.slice(0, 8).toUpperCase(), {
            exact: true,
          }),
        ).toBeVisible()
        await expect(table.locator('.seller-item-price strong')).toHaveText(
          new Intl.NumberFormat(tag, {
            style: 'currency',
            currency: 'SEK',
          }).format(200),
        )
        await expect(table.locator('.seller-item-badge')).toHaveText(
          labels.sellerPortal.itemStates.forSale,
        )
        const date = table.locator('time').first()
        await expect(date).toHaveText(
          new Intl.DateTimeFormat(tag, {
            timeZone: 'Europe/Stockholm',
            dateStyle: 'medium',
          }).format(new Date((await date.getAttribute('datetime'))!)),
        )
        for (const width of [320, 700, 1000]) {
          await page.setViewportSize({ width, height: 900 })
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true)
          await expect(table.locator('.seller-item-price')).toBeVisible()
          if (locale === 'sv')
            await table.screenshot({
              path: test.info().outputPath(`seller-item-${width}.png`),
            })
        }
        const summary = table.getByText(labels.sellerPortal.itemDetails, {
          exact: true,
        })
        await summary.focus()
        await page.keyboard.press('Enter')
        await expect(table.locator('details')).toHaveAttribute('open', '')
      })
    }
    // The sold row must show the actual checkout amount, not its former asking price.
    await f.asActor(f.actor, async () => {
      await f.db.query(
        "select record_sale($1,$2,'manual','synthetic-seller-layout',now(),'SEK',$3::jsonb)",
        [
          f.tenant,
          randomUUID(),
          JSON.stringify([{ itemId: old, priceOre: 15000 }]),
        ],
      )
    })
    await page.context().addCookies([
      {
        name: 'komisio-locale',
        value: 'sv',
        url: new URL(page.url()).origin,
      },
    ])
    await page.reload()
    await expect(rows.locator('.seller-item-badge')).toHaveText(
      d.sellerPortal.itemStates.sold,
    )
    await expect(rows.locator('.seller-item-price strong')).toHaveText(
      /150,00\s+kr/,
    )
    await expect(rows.locator('details')).toHaveCount(0)
    await expect(rows.locator('time')).toBeVisible()
    expect(writes).toEqual([])
  } finally {
    await f.close()
  }
})

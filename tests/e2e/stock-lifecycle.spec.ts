import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('stock cards match upcoming items across pages, ownership and all display languages', async ({
  page,
}) => {
  const email = `stock-stages-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy') || $3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify({ salePeriodDays: 42, markdownSteps: [] }),
      ],
    )
    const soon = []
    for (let n = 0; n < 27; n++)
      soon.push(await f.item(`Soon ${String(n).padStart(2, '0')}`))
    await f.item('Far future')
    const expired = await f.item('Expired')
    const sold = await f.item('Sold')
    const ended = await f.item('Ended')
    const purchase = randomUUID(),
      owned = randomUUID()
    await f.db.query('select register_purchase($1,$2,$3,$4,$5,false)', [
      f.tenant,
      purchase,
      'Owned stock',
      5000,
      'Synthetic receipt',
    ])
    await f.db.query("select accept_item($1,$2,'purchase',$3,null,25000)", [
      f.tenant,
      owned,
      purchase,
    ])
    await f.db.query('select record_sale($1,$2,$3,$4,now(),$5,$6::jsonb)', [
      f.tenant,
      randomUUID(),
      'manual',
      'STOCK-CARD-1',
      'SEK',
      JSON.stringify([{ itemId: sold, priceOre: 20000 }]),
    ])
    // Isolated fixture time travel; real item history is never edited.
    await f.db.query('reset role')
    await f.db.query('alter table public.items disable trigger items_immutable')
    await f.db.query(
      "update public.items set accepted_at=now()-interval '41 days' where id=any($1::uuid[])",
      [soon.concat(sold)],
    )
    await f.db.query(
      "update public.items set accepted_at=now()-interval '43 days' where id=any($1::uuid[])",
      [[expired, ended]],
    )
    await f.db.query(
      'update public.items set terms=jsonb_set(terms,\'{markdownSteps}\',\'[{"afterDays":0,"percent":10}]\') where id=$1',
      [soon[0]],
    )
    await f.db.query('alter table public.items enable trigger items_immutable')
    await f.db.query('set local role authenticated')
    await f.db.query('select end_sale_period($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      ended,
      'charity',
      'Synthetic handover',
    ])
    await f.commit()
    await page.goto('/intake/stock')
    const stages = page.getByRole('region', {
      name: d.stock.stageHeading,
      exact: true,
    })
    await expect(
      stages.getByRole('link', {
        name: `${d.stock.nearingEnd}: 27`,
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      stages.getByRole('link', {
        name: `${d.items.markdownWaiting}: 1`,
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      stages.getByRole('link', {
        name: `${d.lifecycle.title}: ${d.items.markdownWaiting}`,
        exact: true,
      }),
    ).toHaveAttribute('href', '/intake/lifecycle?stage=markdown_due')
    const values = page.getByRole('region', {
      name: d.stock.ownershipValue,
      exact: true,
    })
    await expect(values).toContainText('5800.00 SEK')
    await expect(values).toContainText('250.00 SEK')
    await stages
      .getByRole('link', { name: `${d.stock.nearingEnd}: 27`, exact: true })
      .click()
    await expect(page).toHaveURL(/periodWindow=next7days/)
    const rows = page.locator('.inventory-row')
    await expect(rows).toHaveCount(25)
    await expect(rows.locator('.inventory-item-heading')).toHaveCount(25)
    for (const title of await rows
      .locator('.inventory-title')
      .allTextContents())
      expect(title).toContain('Soon')
    await page
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(rows).toHaveCount(2)
    expect(new URL(page.url()).searchParams.get('periodWindow')).toBe(
      'next7days',
    )
    await page.locator('.inventory-advanced summary').click()
    const chips = page.getByRole('navigation', {
      name: d.items.directory.activeFilters,
      exact: true,
    })
    await chips
      .getByRole('link', {
        name: d.items.directory.removeFilter.replace(
          '{filter}',
          `${d.items.directory.periodWindow}: ${d.stock.nearingEnd}`,
        ),
        exact: true,
      })
      .click()
    await expect(rows).toHaveCount(25)
    expect(new URL(page.url()).searchParams.has('periodWindow')).toBe(false)
    expect(new URL(page.url()).searchParams.has('page')).toBe(false)
    await page.goto('/intake/stock?ownership=store')
    await expect(
      stages.getByRole('link', {
        name: `${d.stock.nearingEnd}: 0`,
        exact: true,
      }),
    ).toBeVisible()
    await stages
      .getByRole('link', {
        name: `${d.lifecycle.stages.on_sale}: 1`,
        exact: true,
      })
      .click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Owned stock')
    expect(new URL(page.url()).searchParams.get('ownership')).toBe('store')
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const translated = JSON.parse(
        await readFile(
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
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/intake/stock')
      await expect(
        page.getByRole('link', {
          name: `${translated.stock.nearingEnd}: 27`,
          exact: true,
        }),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      if (locale === 'sv' || locale === 'de')
        await page.screenshot({
          path: `private/stock-stages-${locale}.png`,
          fullPage: true,
        })
    }
  } finally {
    await f.close()
  }
})

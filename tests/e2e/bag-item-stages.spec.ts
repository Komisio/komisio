import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Locale } from '../../lib/i18n'

test('handover item stages and actual sale price remain clear on mobile in every language', async ({
  page,
}, info) => {
  const email = `bag-stages-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query(
      "select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy') || $3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify({ salePeriodDays: 6, markdownSteps: [] }),
      ],
    )
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic stages',
        f.agreement,
      ])
    ).rows[0].id
    const ids: string[] = []
    for (const title of [
      'Synthetic sold chair',
      'Synthetic ended chair',
      'Synthetic period ending chair',
    ]) {
      const draft = randomUUID(),
        item = randomUUID()
      await f.db.query('select save_inspection_draft($1,$2,$3,$4,0,$5,$6,$7)', [
        f.tenant,
        randomUUID(),
        bag,
        draft,
        title,
        'Chairs',
        'Good',
      ])
      await f.db.query(
        "select accept_item($1,$2,'inspection_draft',$3,1,20000)",
        [f.tenant, item, draft],
      )
      ids.push(item)
    }
    await f.db.query(
      "select record_sale($1,$2,'manual','Synthetic stage sale',now(),'SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify([{ itemId: ids[0], priceOre: 15000 }]),
      ],
    )
    await f.db.query(
      "select end_sale_period($1,$2,$3,'charity','Synthetic ended item')",
      [f.tenant, randomUUID(), ids[1]],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 780 })
    await page.goto(`/intake/bags/${bag}/inspect#bag-registered`)
    for (const locale of [
      'sv',
      'en',
      'no',
      'dk',
      'fi',
      'de',
      'es',
      'it',
    ] as Locale[]) {
      const d = JSON.parse(
        readFileSync(
          new URL('../../messages/' + locale + '.json', import.meta.url),
          'utf8',
        ),
      )
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      await page.reload()
      const rows = page.locator('.bag-received-items li')
      await expect(rows).toHaveCount(3)
      const sold = rows.filter({ hasText: 'Synthetic sold chair' })
      await expect(sold).toContainText(d.lifecycle.stages.sold)
      await expect(sold.locator('strong')).toHaveText(/150[,.]00/)
      await expect(
        rows.filter({ hasText: 'Synthetic ended chair' }),
      ).toContainText(d.lifecycle.stages.ended)
      await expect(
        rows.filter({ hasText: 'Synthetic period ending chair' }),
      ).toContainText(d.lifecycle.stages.period_ending)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
      if (locale === 'fi' || locale === 'de') {
        await page.locator('#bag-registered').scrollIntoViewIfNeeded()
        await page.screenshot({
          path: info.outputPath(`item-stages-${locale}-mobile.png`),
          caret: 'initial',
        })
      }
    }
  } finally {
    await f.close()
  }
})

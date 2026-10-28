import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { readFileSync } from 'node:fs'
import d from '../../messages/sv.json' with { type: 'json' }

test('handover review omits progress counts while retaining registered items and unfinished work', async ({
  page,
}, info) => {
  const email = `bag-progress-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic mixed handover',
        f.agreement,
      ])
    ).rows[0].id
    const acceptedDraft = randomUUID(),
      pending = randomUUID(),
      received = randomUUID()
    for (const id of [acceptedDraft])
      await f.db.query(
        'select pg_temp.prepare_bag_reception($1,$2,$3,$4,0,$5,$6,$7)',
        [f.tenant, randomUUID(), bag, id, 'Synthetic draft', 'Jackets', 'Good'],
      )
    await f.db.query(
      "select accept_item($1,$2,'reception_review',$3,1,20000)",
      [f.tenant, randomUUID(), acceptedDraft],
    )
    for (const id of [pending, received])
      await f.db.query('select create_bag_reception($1,$2,$3,$4)', [
        f.tenant,
        id,
        f.seller,
        bag,
      ])
    await f.db.query(
      'select quick_receive_from_bag($1,$2,$3,$4,0,$5,10000,$6)',
      [
        f.tenant,
        randomUUID(),
        received,
        f.seller,
        { description: 'Synthetic quick item' },
        bag,
      ],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/bags/${bag}/inspect`)
    const summary = page.getByRole('region', { name: d.bagProgress.title })
    await expect(summary).toHaveCount(0)
    await expect(page.locator('.bag-inventory .inventory-row')).toHaveCount(2)
    await expect(
      page.getByRole('button', { name: d.bagProcessing.complete, exact: true }),
    ).toBeDisabled()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320)
    for (const locale of ['en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      await page.reload()
      const translated = page.getByRole('region', {
        name: JSON.parse(
          readFileSync(
            new URL('../../messages/' + locale + '.json', import.meta.url),
            'utf8',
          ),
        ).bagProgress.title,
      })
      await expect(translated).toHaveCount(0)
      await expect(page.locator('.bag-inventory .inventory-row')).toHaveCount(2)
      await expect(
        page.locator(`a[href^="/intake/reception/${pending}"]`),
      ).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
    }
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: 'sv', url: 'http://127.0.0.1:3000' },
      ])
    await page.reload()
    await expect(summary).toHaveCount(0)
    await page.screenshot({
      path: info.outputPath('progress-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    await page
      .getByRole('link', { name: d.bagProgress.resumeReception, exact: false })
      .click()
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/intake/reception/${pending}` &&
        url.searchParams.get('returnTo') === `/intake/bags/${bag}/inspect`,
    )
    await f.asActor(f.actor, async () => {
      await f.db.query(
        'select quick_receive_from_bag($1,$2,$3,$4,0,$5,10000,$6)',
        [
          f.tenant,
          randomUUID(),
          pending,
          f.seller,
          { description: 'Synthetic completed item' },
          bag,
        ],
      )
    })
    await page.goto(`/intake/bags/${bag}/inspect`)
    await expect(page.locator('.bag-inventory .inventory-row')).toHaveCount(3)
    await expect(
      page.getByRole('link', {
        name: d.bagProgress.resumeReception,
        exact: false,
      }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: d.bagProcessing.complete, exact: true }),
    ).toBeEnabled()
    await expect(
      page
        .getByRole('region', { name: d.bagProcessing.title, exact: true })
        .locator('[data-bag-processing-state]'),
    ).toHaveText(d.bagProcessing.open)
  } finally {
    await f.close()
  }
})

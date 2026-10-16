import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const mode of ['quick', 'bag'] as const) {
  test(`${mode} registration offers store types and retains the selected type in item views`, async ({
    page,
  }, info) => {
    const email = `type-select-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      const previous = await f.item('Synthetic existing item')
      for (const [slug, active] of [
        ['synthetic_mug', true],
        ['synthetic_hidden', false],
      ] as const)
        await f.db.query('select set_item_type($1,$2,$3)', [
          f.tenant,
          slug,
          JSON.stringify({
            labels: {
              sv: active ? 'Testmugg' : 'Dold typ',
              en: active ? 'Test mug' : 'Hidden type',
            },
            active,
            attributes: [{ slug: 'description', expected: true, sort: 0 }],
          }),
        ])
      const bag = (
        await f.db.query(
          'select receive_bag_with_agreement($1,$2,$3,$4,$5) id',
          [f.tenant, randomUUID(), f.seller, '', f.agreement],
        )
      ).rows[0].id
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(
        mode === 'quick' ? '/intake/quick' : `/intake/bags/${bag}/inspect`,
      )
      if (mode === 'quick')
        await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
      const type = page.getByRole('combobox', {
        name: d.quickIntake.itemType,
        exact: true,
      })
      await expect(type).toBeVisible()
      await expect(type).not.toHaveAttribute('required')
      await expect(
        type.locator('option[value="synthetic_hidden"]'),
      ).toHaveCount(0)
      await type.selectOption({ label: 'Testmugg' })
      await expect(type).toHaveValue('synthetic_mug')
      await type.selectOption('')
      await expect(type).toHaveValue('')
      await type.selectOption('synthetic_mug')
      await page
        .getByLabel(d.quickIntake.description, { exact: true })
        .fill('Synthetic typed item')
      await page.getByLabel(d.quickIntake.price, { exact: true }).fill('125')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await type.scrollIntoViewIfNeeded()
      await page.screenshot({
        path: info.outputPath(`${mode}-type-mobile.png`),
      })
      const reply = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/intake/quick') &&
          r.request().method() === 'POST',
      )
      await page
        .getByRole('button', {
          name: mode === 'quick' ? d.quickIntake.submit : d.bagIntake.save,
          exact: true,
        })
        .click()
      const response = await reply
      expect(response.status()).toBe(200)
      const result = await response.json()
      await expect(page.locator('.quick-done')).toBeVisible()
      expect(
        (
          await f.db.query(
            'select item_type from item_classification_versions where tenant_id=$1 and item_id=$2 order by version desc limit 1',
            [f.tenant, result.itemId],
          )
        ).rows[0].item_type,
      ).toBe('synthetic_mug')
      expect(
        (
          await f.db.query(
            'select count(*)::int n from item_classification_versions where tenant_id=$1 and item_id=$2',
            [f.tenant, previous],
          )
        ).rows[0].n,
      ).toBe(0)
      await page.goto(`/intake/items/${result.itemId}`)
      await expect(page.locator('.item-workspace')).toContainText('Testmugg')
      await page.goto('/intake/items?itemType=synthetic_mug')
      const rows = page.locator('.inventory-row')
      await expect(rows).toHaveCount(1)
      await expect(rows).toContainText('Synthetic typed item')
      await expect(rows).toContainText('Testmugg')
      if (mode === 'bag') {
        await page.goto(`/intake/bags/${bag}/inspect`)
        await expect(
          page.locator('.bag-inventory .inventory-row'),
        ).toContainText('Testmugg')
      }
    } finally {
      await f.close()
    }
  })
}

test('stepwise reception preserves a manual type through source review and acceptance', async ({
  page,
}, info) => {
  const email = `manual-type-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const session = randomUUID()
    await f.db.query('select create_reception_session($1,$2,$3)', [
      f.tenant,
      session,
      f.seller,
    ])
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/reception/${session}`)
    await page.locator('#garment-description').fill('Synthetic manual coat')
    await page.locator('#garment-type').selectOption('jacket')
    await page.locator('#garment-price').fill('125')
    await page.locator('#garment-reference').fill('Synthetic appraisal')
    await page.locator('#garment-rationale').fill('Synthetic condition')
    await page.screenshot({
      path: info.outputPath('manual-type-mobile.png'),
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole('button', { name: d.reception.saveSources, exact: true })
      .click()
    const steps = page.locator('.reception-step')
    await expect(steps.nth(1)).toHaveAttribute('open', '')
    await expect(steps.nth(1)).toContainText('Jacka')
    await page.reload()
    await steps.first().locator(':scope > summary').click()
    await expect(page.locator('#garment-type')).toHaveValue('jacket')
    await steps.nth(1).locator('input[name="review-final"]').check()
    await steps
      .nth(1)
      .getByRole('button', {
        name: d.reception.storeReview.publish,
        exact: true,
      })
      .click()
    await expect(steps.nth(2)).toHaveAttribute('open', '')
    await page.getByLabel(d.reception.custodyConfirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.reception.custodyRecord, exact: true })
      .click()
    await expect(page.locator(`#accept-price-${session}`)).toBeVisible()
    const accept = page
      .locator('form')
      .filter({ has: page.locator(`#accept-price-${session}`) })
    await accept.getByRole('checkbox').check()
    await accept
      .getByRole('button', { name: d.items.accept, exact: true })
      .click()
    await expect(
      page.getByText(d.items.alreadyAccepted, { exact: true }).first(),
    ).toBeVisible()
    await page.goto('/intake/items?itemType=jacket')
    await expect(page.locator('.inventory-row')).toHaveCount(1)
    await expect(page.locator('.inventory-row')).toContainText(
      'Synthetic manual coat',
    )
    await expect(page.locator('.inventory-row')).toContainText('Jacka')
  } finally {
    await f.close()
  }
})

import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('a category created in settings is available as a type default without reloading', async ({
  page,
}) => {
  const email = `category-settings-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query('select set_item_type($1,$2,$3)', [
      f.tenant,
      'category_test',
      {
        labels: { sv: 'Testtyp' },
        attributes: [],
      },
    ])
    await f.commit()
    await page.goto('/settings?tab=vocabulary#vocabulary-categories')
    const form = page.getByRole('form', {
      name: d.vocabularySettings.addCategory,
      exact: true,
    })
    await form
      .getByLabel(d.vocabularySettings.addCategory, { exact: true })
      .fill('Ny kategori')
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/categories') && r.request().method() === 'POST',
    )
    await form
      .getByRole('button', {
        name: d.vocabularySettings.createCategory,
        exact: true,
      })
      .click()
    const response = await saved
    expect(response.status()).toBe(200)
    const category = (await response.json()).category
    await expect(
      form.getByLabel(d.vocabularySettings.addCategory, { exact: true }),
    ).toHaveValue('')
    await page
      .getByRole('tab', { name: d.vocabularySettings.types, exact: true })
      .click()
    await page
      .getByRole('row')
      .filter({
        has: page.getByRole('rowheader').filter({ hasText: 'Testtyp' }),
      })
      .getByRole('button', { name: d.catalogueEditing.edit, exact: true })
      .click()
    const editor = page.getByRole('form', {
      name: 'Redigera: Testtyp',
      exact: true,
    })
    await editor
      .getByLabel(d.catalogueEditing.suggestedCategory, { exact: true })
      .selectOption(category.id)
    await editor
      .getByRole('button', { name: d.catalogueEditing.save, exact: true })
      .click()
    await expect(editor).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select suggested_category_id from item_types where tenant_id=$1 and slug=$2',
          [f.tenant, 'category_test'],
        )
      ).rows[0].suggested_category_id,
    ).toBe(category.id)
  } finally {
    await f.close()
  }
})

for (const bagFlow of [false, true]) {
  test(`${bagFlow ? 'bag' : 'quick'} reception prefills and overrides linked categories`, async ({
    page,
  }, testInfo) => {
    const email = `linked-category-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      const first = randomUUID(),
        second = randomUUID()
      for (const [id, name] of [
        [first, 'Books A'],
        [second, 'Books B'],
      ])
        await f.db.query('select create_item_category($1,$2,$3,$4)', [
          f.tenant,
          id,
          name,
          { en: name, sv: 'Böcker' },
        ])
      await f.db.query('select set_item_type($1,$2,$3)', [
        f.tenant,
        'synthetic_book',
        {
          labels: { sv: 'Testbok' },
          attributes: [
            { slug: 'description', expected: true, sort: 0 },
            { slug: 'category', expected: false, sort: 1 },
          ],
        },
      ])
      const bag = bagFlow
        ? (
            await f.db.query(
              'select receive_bag_with_agreement($1,$2,$3,$4,$5) id',
              [
                f.tenant,
                randomUUID(),
                f.seller,
                'Synthetic category bag',
                f.agreement,
              ],
            )
          ).rows[0].id
        : null
      await f.commit()
      await page.goto('/settings?tab=vocabulary#vocabulary-types')
      await page
        .getByRole('row')
        .filter({
          has: page.getByRole('rowheader').filter({ hasText: 'Testbok' }),
        })
        .getByRole('button', { name: d.catalogueEditing.edit, exact: true })
        .click()
      const editor = page.getByRole('form', {
        name: 'Redigera: Testbok',
        exact: true,
      })
      await editor
        .getByLabel(d.catalogueEditing.suggestedCategory, { exact: true })
        .selectOption(first)
      await expect(
        editor.getByRole('checkbox', {
          name: d.quickIntake.category,
          exact: true,
        }),
      ).toHaveCount(0)
      await editor
        .getByRole('button', { name: d.catalogueEditing.save, exact: true })
        .click()
      await expect(editor).toHaveCount(0)
      await page.goto(bag ? `/intake/bags/${bag}/inspect` : '/intake/quick')
      if (!bag)
        await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
      const category = page.getByLabel(d.quickIntake.category, { exact: true })
      await expect(category).toHaveCount(1)
      await expect(category).toHaveValue('')
      await page
        .getByLabel(d.quickIntake.itemType, { exact: true })
        .selectOption('synthetic_book')
      await expect(category).toHaveValue(first)
      await expect(category.locator('option')).toContainText([
        'Ingen kategori',
        'Böcker (Books A)',
        'Böcker (Books B)',
      ])
      await category.selectOption(second)
      await page
        .getByLabel(d.quickIntake.description, { exact: true })
        .fill('Synthetic category override')
      await page.getByLabel(d.quickIntake.price, { exact: true }).fill('120')
      await page.screenshot({
        path: testInfo.outputPath('category-registration.png'),
        fullPage: true,
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      const submit = page.getByRole('button', {
        name: bag ? d.bagIntake.save : d.quickIntake.submit,
        exact: true,
      })
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/intake/quick') &&
          r.request().method() === 'POST',
      )
      await submit.click()
      const response = await saved
      expect(response.status()).toBe(200)
      const item = (await response.json()).itemId
      expect(
        (
          await f.db.query(
            'select category_id from item_category_links where item_id=$1 order by seq desc limit 1',
            [item],
          )
        ).rows[0].category_id,
      ).toBe(second)
      if (bag)
        await expect(page.locator('.bag-inventory .inventory-row')).toHaveCount(
          1,
        )
      await page
        .getByRole('button', {
          name: bag ? d.bagIntake.next : d.quickIntake.next,
          exact: true,
        })
        .click()
      await expect(category).toHaveValue(first)
      await category.selectOption('')
      await page
        .getByLabel(d.quickIntake.description, { exact: true })
        .fill('Synthetic uncategorized')
      await page.getByLabel(d.quickIntake.price, { exact: true }).fill('100')
      const emptySaved = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/intake/quick') &&
          r.request().method() === 'POST',
      )
      await submit.click()
      const emptyResponse = await emptySaved
      expect(emptyResponse.status()).toBe(200)
      const emptyItem = (await emptyResponse.json()).itemId
      expect(
        (
          await f.db.query(
            'select category_id from item_category_links where item_id=$1 order by seq desc limit 1',
            [emptyItem],
          )
        ).rows[0].category_id,
      ).toBeNull()
      await expect(
        page.getByRole('button', {
          name: bag ? d.bagIntake.next : d.quickIntake.next,
          exact: true,
        }),
      ).toBeVisible()
      if (bag)
        await expect(page.locator('.bag-inventory .inventory-row')).toHaveCount(
          2,
        )
      await page.goto(`/intake/items?categoryId=${second}`)
      await expect(page.locator('.inventory-row')).toHaveCount(1)
      await expect(page.locator('.inventory-row')).toContainText(
        'Synthetic category override',
      )
      await page.goto('/intake/items?categoryId=none')
      await expect(page.locator('.inventory-row')).toHaveCount(1)
      await expect(page.locator('.inventory-row')).toContainText(
        'Synthetic uncategorized',
      )
      await page.goto('/intake/stock#stock-categories')
      await page
        .getByRole('tab', { name: d.stock.tabs.categories, exact: true })
        .click()
      await expect(
        page.getByRole('region', { name: d.stock.categoriesHeading }),
      ).toContainText('Böcker (Books B)')
      await expect(
        page.getByRole('region', { name: d.stock.categoriesHeading }),
      ).toContainText(d.stock.uncategorised)
    } finally {
      await f.close()
    }
  })
}

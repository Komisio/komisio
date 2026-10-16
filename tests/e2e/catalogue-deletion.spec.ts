import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('settings delete unused catalogue records and explain usage', async ({
  page,
}, testInfo) => {
  const email = `catalogue-delete-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.item('Synthetic catalogue item')
    await f.db.query(
      'select create_item_category($1,$2,\'Jackets\',\'{"en":"Jackets"}\')',
      [f.tenant, randomUUID()],
    )
    await f.db.query(
      'select set_attribute_definition($1,\'test_field\',\'{"dataType":"text","labels":{"en":"Test field"}}\')',
      [f.tenant],
    )
    await f.db.query(
      'select set_item_type($1,\'test_type\',\'{"labels":{"en":"Test type"},"attributes":[{"slug":"test_field"}]}\')',
      [f.tenant],
    )
    await f.db.query("select create_assortment_group($1,$2,'Test group')", [
      f.tenant,
      randomUUID(),
    ])
    await f.commit()
    await page.goto('/settings?tab=vocabulary#vocabulary-categories')
    const command = { tenantId: f.tenant, kind: 'type', key: 'trousers' }
    expect(
      (
        await page.request.post('/api/catalogue/delete', { data: command })
      ).status(),
    ).toBe(403)
    expect(
      (
        await page.request.post('/api/catalogue/delete', {
          headers: { origin: new URL(page.url()).origin },
          data: { ...command, tenantId: randomUUID() },
        })
      ).status(),
    ).toBe(409)
    async function remove(
      name: string,
      tab: 'categories' | 'types' | 'attributes' | 'groups',
      blocked = false,
    ) {
      await page
        .getByRole('tab', { name: d.vocabularySettings[tab], exact: true })
        .click()
      const row = page
        .locator(`#vocabulary-${tab}`)
        .getByRole('row')
        .filter({
          has: page.getByRole('rowheader').filter({ hasText: name }),
        })
      await row
        .getByRole('button', {
          name: `${d.catalogueDeletion.remove}: ${name}`,
          exact: true,
        })
        .click()
      await expect(
        row.getByText(d.catalogueDeletion.confirm.replace('{name}', name), {
          exact: true,
        }),
      ).toBeVisible()
      await row
        .getByRole('button', {
          name: d.catalogueDeletion.confirmAction,
          exact: true,
        })
        .click()
      if (blocked)
        await expect(row.getByRole('alert')).toContainText(
          d.catalogueDeletion.inUse,
        )
      else await expect(row).toHaveCount(0)
    }
    await remove('Jackets', 'categories', true)
    await remove('Hem och inredning', 'categories')
    await remove('Test field', 'attributes', true)
    await remove('Test type', 'types')
    await remove('Test field', 'attributes')
    await remove('Byxor', 'types')
    await remove('Test group', 'groups')
    await page.reload()
    await expect(
      page.getByRole('button', {
        name: `${d.catalogueDeletion.remove}: Test group`,
        exact: true,
      }),
    ).toHaveCount(0)
    await page
      .getByRole('tab', { name: d.vocabularySettings.categories, exact: true })
      .click()
    await page.setViewportSize({ width: 390, height: 844 })
    await remove('Jackets', 'categories', true)
    await page.screenshot({
      path: testInfo.outputPath('catalogue-delete-mobile.png'),
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await f.close()
  }
})

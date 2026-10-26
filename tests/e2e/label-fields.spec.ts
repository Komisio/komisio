import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function openFields(page: import('@playwright/test').Page) {
  await page.goto('/settings?tab=printing#printing-labels')
  const form = page.locator('.label-fields-form')
  await form.locator('summary').click()
  await expect(form.getByLabel(d.labelFields.custom)).toBeVisible()
  return form
}

test('store label fields survive a lost reply and reach individual labels and both PDF sizes', async ({
  page,
}, testInfo) => {
  const email = `label-fields-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const session = (
      await f.db.query('select create_reception_session($1,$2,$3) id', [
        f.tenant,
        randomUUID(),
        f.seller,
      ])
    ).rows[0].id
    const item = (
      await f.db.query(
        "select quick_receive_classified($1,$2,$3,$4,0,$5,15000,null,'trousers',null) value",
        [
          f.tenant,
          randomUUID(),
          session,
          f.seller,
          {
            description: '.',
            brand: 'Synthetic brand',
            color: 'Blue',
            size: 'M',
            material: 'Wool',
          },
        ],
      )
    ).rows[0].value
    const purchase = randomUUID(),
      own = randomUUID()
    await f.db.query(
      "select register_purchase($1,$2,'Synthetic own item',10000,'Synthetic receipt',false)",
      [f.tenant, purchase],
    )
    await f.db.query("select accept_item($1,$2,'purchase',$3,null,15000)", [
      f.tenant,
      own,
      purchase,
    ])
    await f.commit()
    const form = await openFields(page)
    await form.getByLabel(d.labelFields.custom).check()
    const selects = form.getByRole('combobox')
    await selects.nth(0).selectOption('size')
    await selects.nth(1).selectOption('brand')
    await selects.nth(2).selectOption('material')
    const requests: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      const payload = route.request().postDataJSON()
      if (payload.action !== 'setItemLabelFields') return route.continue()
      requests.push(payload)
      const response = await route.fetch()
      if (requests.length === 1) return route.abort('failed')
      await route.fulfill({ response })
    })
    await form
      .getByRole('button', { name: d.labelFields.save, exact: true })
      .click()
    await expect(
      form.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toBeVisible()
    await expect(selects.nth(0)).toBeDisabled()
    await form
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(form.getByRole('status')).toHaveText(d.labelFields.saved)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(
      (
        await f.db.query(
          "select attribute_revision from label_formats where tenant_id=$1 and kind='item'",
          [f.tenant],
        )
      ).rows[0].attribute_revision,
    ).toBe(1)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: testInfo.outputPath('label-fields-mobile.png'),
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.goto(`/intake/items/${item.itemId}/label`)
    const label = page.locator('.item-browser-label')
    await expect(label.locator('h2')).toHaveCount(0)
    await expect(label.locator('.grid p')).toHaveText([
      'Storlek: M',
      'Märke: Synthetic brand',
      'Material: Wool',
    ])
    await expect(label).toContainText('150.00 SEK')
    await expect(label).not.toContainText('Synthetic P2 seller')
    await expect(label.locator('img')).toBeVisible()
    for (const size of ['50x50', '57x32']) {
      const pdf = await page.request.get(
        `/api/items/labels?tenant=${f.tenant}&items=${item.itemId}&size=${size}&download=1`,
      )
      expect(pdf.status()).toBe(200)
      expect(pdf.headers()['content-disposition']).toContain(
        'Synthetic P2 seller',
      )
      await testInfo.attach(`single-${size}.pdf`, {
        body: await pdf.body(),
        contentType: 'application/pdf',
      })
    }
    const mixed = await page.request.get(
      `/api/items/labels?tenant=${f.tenant}&items=${item.itemId},${own}&size=57x32`,
    )
    expect(mixed.status()).toBe(200)
    expect(mixed.headers()['content-disposition']).toContain('komisio-labels')
  } finally {
    await f.close()
  }
})

test('stale label editors reload and explicit empty fields differ from type defaults', async ({
  page,
}) => {
  const email = `label-stale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    const form = await openFields(page)
    await form.getByLabel(d.labelFields.custom).check()
    await form.getByRole('combobox').nth(0).selectOption('brand')
    await f.asActor(f.actor, () =>
      f.db.query("select set_item_label_fields($1,$2,0,array['size'])", [
        f.tenant,
        randomUUID(),
      ]),
    )
    await form
      .getByRole('button', { name: d.labelFields.save, exact: true })
      .click()
    await expect(
      form.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toBeVisible()
    await expect(form.getByRole('combobox').nth(0)).toBeDisabled()
    await form
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await form.locator('summary').click()
    await expect(form.getByRole('combobox').nth(0)).toHaveValue('size')
    await form.getByRole('combobox').nth(0).selectOption('')
    await form
      .getByRole('button', { name: d.labelFields.save, exact: true })
      .click()
    await expect(form.getByRole('status')).toHaveText(d.labelFields.saved)
    await form.getByLabel(d.labelFields.custom).uncheck()
    await form
      .getByRole('button', { name: d.labelFields.save, exact: true })
      .click()
    await expect(form.getByRole('status')).toHaveText(d.labelFields.saved)
    expect(
      (
        await f.db.query(
          "select attribute_order,attribute_revision from label_formats where tenant_id=$1 and kind='item'",
          [f.tenant],
        )
      ).rows[0],
    ).toEqual({ attribute_order: null, attribute_revision: 3 })
  } finally {
    await f.close()
  }
})

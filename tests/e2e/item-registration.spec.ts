import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('store defaults generate a searchable title and keep notes private, including lost replies', async ({
  page,
}) => {
  const email = `registration-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=vocabulary')
    const settings = page
      .locator('section')
      .filter({
        has: page.getByRole('heading', {
          name: d.registration.title,
          exact: true,
        }),
      })
      .last()
    await settings
      .getByLabel(d.registration.template, { exact: true })
      .fill('TEST {brand} {size}')
    await settings
      .getByRole('button', { name: d.registration.save, exact: true })
      .click()
    await expect(settings.getByRole('status')).toHaveText(d.registration.saved)
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await expect(page.locator('#quick-description')).not.toHaveAttribute(
      'required',
    )
    await page.locator('#quick-brand').fill('Synthetic')
    await page.locator('#quick-size').fill('M')
    await page.locator('#quick-internal-note').fill('PRIVATE sleeve defect')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('200')
    let original: unknown
    let drop = true
    await page.route('**/api/intake/quick', async (route) => {
      const body = route.request().postDataJSON()
      if (!original) original = body
      else expect(body).toEqual(original)
      const response = await route.fetch()
      if (drop) {
        drop = false
        await route.abort('connectionfailed')
      } else await route.fulfill({ response })
    })
    await page
      .getByRole('button', { name: d.quickIntake.submit, exact: true })
      .click()
    await expect(page.locator('#quick-internal-note')).toBeDisabled()
    await page
      .getByRole('button', { name: d.quickIntake.retry, exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toContainText(/I-[0-9A-F]{8}/)
    const rows = (
      await f.db.query('select id from items where tenant_id=$1', [f.tenant])
    ).rows
    expect(rows).toHaveLength(1)
    const item = rows[0].id
    expect(
      (
        await f.db.query(
          'select count(*)::int n from item_internal_notes where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await page.goto('/intake/items?q=TEST%20Synthetic')
    await expect(page.getByText('TEST Synthetic M').first()).toBeVisible()
    await page.goto(`/intake/items/${item}`)
    await expect(
      page.getByLabel(d.registration.note, { exact: true }),
    ).toHaveValue('PRIVATE sleeve defect')
    await page.screenshot({
      path: test.info().outputPath('item-registration.png'),
      fullPage: true,
    })
    const label = await f.asActor(
      f.actor,
      async () =>
        (
          await f.db.query('select item_label_facts($1,$2) data', [
            f.tenant,
            item,
          ])
        ).rows[0].data,
    )
    expect(label.title).toBe('TEST Synthetic M')
    expect(JSON.stringify(label)).not.toContain('PRIVATE')
    // Changing the global requirement affects the no-type form as well.
    await page.goto('/settings?tab=vocabulary')
    await settings
      .getByLabel(d.registration.descriptionRequired, { exact: true })
      .check()
    await settings
      .getByRole('button', { name: d.registration.save, exact: true })
      .click()
    await expect(settings.getByRole('status')).toHaveText(d.registration.saved)
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await expect(page.locator('#quick-description')).toHaveAttribute(
      'required',
      '',
    )
  } finally {
    await f.close()
  }
})

test('stepwise and own-stock registration keep optional descriptions and private notes', async ({
  page,
}) => {
  const email = `registration-flows-${randomUUID()}@example.test`
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
    await page.goto(`/intake/reception/${session}`)
    await expect(page.locator('#garment-description')).not.toHaveAttribute(
      'required',
    )
    await page.locator('#garment-type').selectOption('jacket')
    await page.locator('#registration-brand').fill('Manual Brand')
    await page.locator('#registration-size').fill('M')
    await page.locator('#manual-internal-note').fill('PRIVATE manual note')
    await page.locator('#garment-price').fill('125')
    await page.locator('#garment-reference').fill('Synthetic appraisal')
    await page.locator('#garment-rationale').fill('Staff assessment')
    await page
      .getByRole('button', { name: d.reception.saveSources, exact: true })
      .click()
    const steps = page.locator('.reception-step')
    await expect(steps.nth(1)).toHaveAttribute('open', '')
    await expect(steps.nth(1)).not.toContainText('PRIVATE')
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
    await expect
      .poll(
        async () =>
          (
            await f.db.query(
              'select count(*)::int n from items where tenant_id=$1 and origin_id=$2',
              [f.tenant, session],
            )
          ).rows[0].n,
      )
      .toBe(1)
    const item = (
      await f.db.query(
        'select id from items where tenant_id=$1 and origin_id=$2',
        [f.tenant, session],
      )
    ).rows[0].id
    await page.goto(`/intake/items/${item}`)
    await expect(
      page.getByLabel(d.registration.note, { exact: true }),
    ).toHaveValue('PRIVATE manual note')
    await expect(
      page.getByRole('heading', { name: 'Jacka Manual Brand M', exact: true }),
    ).toBeVisible()
    await page.goto('/intake/purchases#purchases-register')
    // Activate the new-purchase workspace through its visible tab.
    await page
      .getByRole('tab', { name: d.purchases.newPurchase, exact: true })
      .click()
    await expect(page.locator('#purchase-note')).not.toHaveAttribute('required')
    await page.locator('#purchase-type').selectOption('jacket')
    await page.locator('#registration-brand').fill('Own Brand')
    await page.locator('#purchase-internal-note').fill('PRIVATE own note')
    await page.locator('#purchase-price').fill('100')
    await page.locator('#purchase-evidence').fill('Synthetic receipt')
    const form = page
      .locator('form')
      .filter({ has: page.locator('#purchase-price') })
    await form.locator('button[type="submit"]').click()
    await expect
      .poll(
        async () =>
          (
            await f.db.query(
              'select count(*)::int n from purchase_receipts where tenant_id=$1',
              [f.tenant],
            )
          ).rows[0].n,
      )
      .toBe(1)
    const receipt = (
      await f.db.query('select id from purchase_receipts where tenant_id=$1', [
        f.tenant,
      ])
    ).rows[0].id
    await form
      .getByRole('link', { name: d.purchases.continueToItem, exact: true })
      .click()
    await page.locator(`a[href^="/intake/purchases/${receipt}?"]`).click()
    await expect(
      page.getByLabel(d.registration.note, { exact: true }),
    ).toHaveValue('PRIVATE own note')
  } finally {
    await f.close()
  }
})

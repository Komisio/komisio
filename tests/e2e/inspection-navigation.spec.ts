import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function fixture(page: Page) {
  const email = `inspection-navigation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const bag = (
    await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
      f.tenant,
      randomUUID(),
      f.seller,
      'Synthetic navigation bag',
      f.agreement,
    ])
  ).rows[0].id as string
  const draft = randomUUID()
  await f.db.query('select save_inspection_draft($1,$2,$3,$4,0,$5,$6,$7)', [
    f.tenant,
    randomUUID(),
    bag,
    draft,
    'Synthetic pending coat',
    'Jackets',
    'Good',
  ])
  for (let n = 0; n < 26; n++) {
    const source = randomUUID()
    await f.db.query('select save_inspection_draft($1,$2,$3,$4,0,$5,$6,$7)', [
      f.tenant,
      randomUUID(),
      bag,
      source,
      `Synthetic registered ${n}`,
      'Jackets',
      'Good',
    ])
    await f.db.query(
      "select accept_item($1,$2,'inspection_draft',$3,1,20000)",
      [f.tenant, randomUUID(), source],
    )
  }
  const sold = await f.item('Synthetic reference sale')
  await f.db.query(
    "select record_sale($1,$2,'manual','synthetic-navigation',now(),'SEK',$3::jsonb)",
    [
      f.tenant,
      randomUUID(),
      JSON.stringify([{ itemId: sold, priceOre: 15000 }]),
    ],
  )
  await f.commit()
  return { f, bag, draft, sold }
}

async function confirmLink(
  page: Page,
  link: Locator,
  accept: boolean,
  message: string,
) {
  const waiting = page.waitForEvent('dialog')
  const clicking = link.click()
  const dialog = await waiting
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(message)
  if (accept) await dialog.accept()
  else await dialog.dismiss()
  await clicking
}

test('registered-item paging preserves quick entry and its uncertain save without warning', async ({
  page,
}) => {
  const { f, bag } = await fixture(page)
  try {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/intake/bags/${bag}/inspect`)
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic interrupted quick entry')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('140')
    let unexpected = 0
    const acceptUnexpected = async (
      dialog: import('@playwright/test').Dialog,
    ) => {
      unexpected++
      await dialog.accept()
    }
    page.on('dialog', acceptUnexpected)
    await page
      .locator('#bag-registered')
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(page).toHaveURL(/itemPage=2/)
    await expect(description).toHaveValue('Synthetic interrupted quick entry')
    const commands: unknown[] = []
    await page.route('**/api/intake/quick', async (route) => {
      commands.push(route.request().postDataJSON())
      if (commands.length > 1) return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'REQUEST_FAILED' }),
      })
    })
    await page
      .getByRole('button', { name: d.bagIntake.save, exact: true })
      .click()
    await expect(page.locator('.quick-item').getByRole('alert')).toHaveText(
      d.quickIntake.uncertain,
    )
    await page
      .locator('#bag-registered')
      .getByRole('link', { name: d.items.previousPage, exact: true })
      .click()
    await expect(page).toHaveURL(/itemPage=1/)
    await expect(description).toHaveValue('Synthetic interrupted quick entry')
    await expect(description).toBeDisabled()
    expect(unexpected).toBe(0)
    page.off('dialog', acceptUnexpected)
    await confirmLink(
      page,
      page.locator('.bag-inspection-links a[href="?view=drafts"]'),
      false,
      d.quickIntake.leaveItem,
    )
    await page.locator('.quick-finish').getByRole('button').click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toBeVisible()
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(28)
  } finally {
    await f.close()
  }
})

test('inspection edits survive paging and cancelled evidence, shell and unload navigation', async ({
  page,
}) => {
  const { f, bag, draft, sold } = await fixture(page)
  try {
    await page.setViewportSize({ width: 320, height: 800 })
    const path = `/intake/bags/${bag}/inspect?view=drafts&draft=${draft}`
    await page.goto(path)
    const description = page.getByLabel(d.inspection.description, {
      exact: true,
    })
    await description.fill('Synthetic unsaved edit')
    let unexpected = 0
    const acceptUnexpected = async (
      dialog: import('@playwright/test').Dialog,
    ) => {
      unexpected++
      await dialog.accept()
    }
    page.on('dialog', acceptUnexpected)
    await page
      .locator('#bag-registered')
      .getByRole('link', { name: d.items.nextPage, exact: true })
      .click()
    await expect(page).toHaveURL(/itemPage=2/)
    await expect(description).toHaveValue('Synthetic unsaved edit')
    expect(unexpected).toBe(0)
    page.off('dialog', acceptUnexpected)
    const evidence = page
      .getByRole('region', { name: d.priceEvidence.title, exact: true })
      .getByRole('link', { name: 'Synthetic reference sale', exact: true })
    for (const link of [
      evidence,
      page.locator('.mobile-nav a[href="/intake/items"]'),
      page.locator('.bag-received-items li a').first(),
    ]) {
      await confirmLink(page, link, false, d.inspection.leaveDraft)
      await expect(description).toHaveValue('Synthetic unsaved edit')
    }
    const waiting = page.waitForEvent('dialog')
    await page.evaluate(() => {
      setTimeout(() => window.location.reload(), 0)
    })
    const dialog = await waiting
    expect(dialog.type()).toBe('beforeunload')
    await dialog.dismiss()
    await expect(description).toHaveValue('Synthetic unsaved edit')
    await confirmLink(page, evidence, true, d.inspection.leaveDraft)
    await expect(page).toHaveURL(new RegExp(`/intake/items/${sold}$`))
    await page.goto(path)
    await expect(description).toHaveValue('Synthetic pending coat')
    // Reverting the fields removes the warning, rather than latching dirty forever.
    await description.fill('Synthetic reverted edit')
    await description.fill('Synthetic pending coat')
    page.on('dialog', acceptUnexpected)
    await evidence.click()
    await expect(page).toHaveURL(new RegExp(`/intake/items/${sold}$`))
    expect(unexpected).toBe(0)
    page.off('dialog', acceptUnexpected)
    await page.goto(path)
    await description.fill('Synthetic confirmed draft edit')
    await page
      .getByRole('button', { name: d.inspection.save, exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText(d.inspection.saved)
    page.on('dialog', acceptUnexpected)
    await page
      .locator('.inspection-saved-actions')
      .getByRole('link', { name: d.inspection.resume, exact: true })
      .click()
    await expect(description).toHaveValue('Synthetic confirmed draft edit')
    expect(unexpected).toBe(0)
  } finally {
    await f.close()
  }
})

test('cancelled draft navigation preserves the exact uncertain save and one revision', async ({
  page,
}) => {
  const { f, bag, draft } = await fixture(page)
  try {
    await page.goto(`/intake/bags/${bag}/inspect?view=drafts&draft=${draft}`)
    const description = page.getByLabel(d.inspection.description, {
      exact: true,
    })
    await description.fill('Synthetic uncertain draft revision')
    const commands: unknown[] = []
    await page.route('**/api/intake', async (route) => {
      if (route.request().postDataJSON()?.action !== 'saveInspection')
        return route.continue()
      commands.push(route.request().postDataJSON())
      if (commands.length > 1) return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'REQUEST_FAILED' }),
      })
    })
    const save = page.getByRole('button', {
      name: d.inspection.save,
      exact: true,
    })
    await save.click()
    await expect(page.locator('form').getByRole('alert')).toHaveText(
      d.intake.failed,
    )
    await confirmLink(
      page,
      page
        .getByRole('region', { name: d.priceEvidence.title, exact: true })
        .getByRole('link')
        .first(),
      false,
      d.inspection.leaveDraft,
    )
    await expect(description).toBeDisabled()
    await save.click()
    await expect(page.getByRole('status')).toContainText(d.inspection.saved)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from inspection_draft_revisions where tenant_id=$1 and draft_id=$2',
          [f.tenant, draft],
        )
      ).rows[0].n,
    ).toBe(2)
  } finally {
    await f.close()
  }
})

import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('seller search applies text entered before hydration', async ({
  page,
}) => {
  const email = `early-search-${randomUUID()}@example.test`
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await f.commit()
    await page.route('**/_next/static/**', async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('.js')) await held
      await route.continue()
    })
    await page.goto('/intake', { waitUntil: 'commit' })
    const search = page.locator('#seller-search')
    await search.fill('Before hydration')
    release()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'))
      .toBe('Before hydration')
    await expect(search).toHaveValue('Before hydration')
    await expect(search).toBeFocused()
    await expect(
      page.getByText(d.intake.noSellers, { exact: true }),
    ).toBeVisible()
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('live seller search preserves newer text and cursor when an older response arrives', async ({
  page,
}) => {
  const email = `live-search-${randomUUID()}@example.test`
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let received!: () => void
  const responseReady = new Promise<void>((resolve) => {
    received = resolve
  })
  try {
    await f.commit()
    await page.goto('/intake?state=unstarted#seller-search')
    const search = page.locator('#seller-search')
    const historyLength = await page.evaluate(() => history.length)
    await page.route('**/intake?**', async (route) => {
      if (new URL(route.request().url()).searchParams.get('q') !== 'Synth')
        return route.continue()
      const response = await route.fetch()
      received()
      await held
      await route.fulfill({ response })
    })
    await search.fill('Synth')
    await responseReady
    await search.press('End')
    await search.pressSequentially('etic')
    await search.press('ArrowLeft')
    release()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'))
      .toBe('Synthetic')
    await expect(page.locator('.intake-seller-results li')).toHaveCount(1)
    await expect(search).toHaveValue('Synthetic')
    await expect(search).toBeFocused()
    expect(
      await search.evaluate((input: HTMLInputElement) => input.selectionStart),
    ).toBe(8)
    expect(new URL(page.url()).searchParams.get('state')).toBe('unstarted')
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
    await search.fill('')
    await expect
      .poll(() => new URL(page.url()).searchParams.has('q'))
      .toBe(false)
    await expect(search).toBeFocused()
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
    expect(new URL(page.url()).hash).toBe('#seller-search')
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('bag intake finds all sellers by contact and focuses reception without skipping required agreement', async ({
  page,
}, testInfo) => {
  const email = 'intake-search-' + randomUUID() + '@example.test'
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 53; i++)
      await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        'Paged intake ' + String(i).padStart(2, '0'),
        'bag-' + randomUUID() + '@example.test',
        '0701111111',
      ])
    const target = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'ZZ Intake target',
        'intake-target@example.test',
        '0708765432',
      ])
    ).rows[0].id
    await f.db.query(
      'select publish_seller_agreement($1,$2,$3,$4,$5,$6,true) id',
      [
        f.tenant,
        randomUUID(),
        f.agreement,
        'Required synthetic agreement',
        'Synthetic test terms',
        'sv',
      ],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake?q=Paged&sellerPage=5')
    const rows = page.locator('.intake-seller-results li')
    const search = page.getByLabel(d.sellersList.search, { exact: true })
    await expect(rows).toHaveCount(5)
    await expect(
      page.getByRole('link', { name: d.sellersList.nextPage, exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('link', { name: d.sellersList.previousPage, exact: true })
      .click()
    await expect(rows).toHaveCount(12)
    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'))
      .toBe('Paged')
    const historyLength = await page.evaluate(() => history.length)
    await search.fill('0708765432')
    const scrollBefore = await page.evaluate(() => window.scrollY)
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('ZZ Intake target')
    await expect(search).toBeFocused()
    // A shorter mobile page may clamp scrolling at its new bottom edge.
    const scroll = await page.evaluate(() => ({
      y: window.scrollY,
      max: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    }))
    expect(scroll.y).toBeCloseTo(Math.min(scrollBefore, scroll.max), 0)
    await expect(search).toBeInViewport()
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
    expect(new URL(page.url()).hash).toBe('#seller-search')
    await expect
      .poll(() => new URL(page.url()).searchParams.has('sellerPage'))
      .toBe(false)
    await page.goBack()
    await expect(search).toHaveValue('Paged')
    await expect(rows).toHaveCount(5)
    await page.goForward()
    await expect(search).toHaveValue('0708765432')
    await expect(rows).toHaveCount(1)
    await rows.getByRole('link').click()
    await expect(page).toHaveURL('/intake?seller=' + target + '#new-seller')
    const receiving = page.locator('#new-seller')
    await expect
      .poll(async () => (await receiving.boundingBox())?.y ?? 9999)
      .toBeLessThan(100)
    const agreementTab = page.getByRole('tab', {
      name: `${d.agreements.tabLabel} — ${d.agreements.tabMissing}`,
      exact: true,
    })
    await expect(agreementTab).toHaveAttribute('data-status', 'missing')
    await expect(page.locator('.agreement-at-intake')).toBeHidden()
    await expect(
      receiving.getByRole('button', { name: d.intake.saveBag, exact: true }),
    ).toBeDisabled()
    await expect(receiving).toContainText(d.intake.agreementRequired)
    await page.screenshot({
      path: testInfo.outputPath('intake-selected-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await receiving
      .getByLabel(d.intake.note, { exact: true })
      .fill('Synthetic received item')
    await receiving.getByLabel(d.intake.custody, { exact: true }).check()
    await receiving
      .getByRole('link', { name: `${d.agreements.tabLabel} →`, exact: true })
      .click()
    await expect(agreementTab).toHaveAttribute('aria-selected', 'true')
    const evidenceForm = page.locator('.agreement-evidence-form')
    await evidenceForm
      .getByLabel(d.agreements.reference, { exact: true })
      .fill('Synthetic paper evidence')
    await evidenceForm
      .getByLabel(d.agreements.confirmEvidence, { exact: true })
      .check()
    await evidenceForm
      .getByRole('button', { name: d.agreements.record, exact: true })
      .click()
    await expect(
      page.getByRole('tab', {
        name: `${d.agreements.tabLabel} — ${d.agreements.tabApproved}`,
        exact: true,
      }),
    ).toHaveAttribute('data-status', 'approved')
    await page.getByRole('tab').first().click()
    await expect(
      receiving.getByRole('button', { name: d.intake.saveBag, exact: true }),
    ).toBeEnabled()
    await expect(
      receiving.getByLabel(d.intake.note, { exact: true }),
    ).toHaveValue('Synthetic received item')
    await expect(
      receiving.getByLabel(d.intake.custody, { exact: true }),
    ).toBeChecked()
    await receiving
      .getByRole('button', { name: d.intake.saveBag, exact: true })
      .click()
    await expect(page).toHaveURL((url) =>
      /^\/intake\/bags\/[0-9a-f-]{36}$/.test(url.pathname),
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from bag_receipts where tenant_id=$1 and seller_id=$2',
          [f.tenant, target],
        )
      ).rows[0].n,
    ).toBe(1)
    await page
      .getByRole('link', { name: d.returnNavigation.back, exact: true })
      .click()
    await receiving
      .getByRole('link', { name: d.quickIntake.changeSeller, exact: true })
      .click()
    await expect(search).toBeInViewport()
    await search.fill('intake-target@example.test')
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('ZZ Intake target')
    await search.fill('')
    await expect(search).toHaveValue('')
    await expect(rows).toHaveCount(12)
    await page.goto('/intake?q=Paged&sellerPage=999')
    await expect(rows).toHaveCount(5)
    await expect
      .poll(() => new URL(page.url()).searchParams.get('sellerPage'))
      .toBe('5')
    await search.fill('No matching intake seller')
    await search.press('Enter')
    await expect(rows).toHaveCount(0)
    await expect(
      page.getByText(d.intake.noSellers, { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('link', { name: d.intake.newSellerAction, exact: true })
      .click()
    await expect(page.getByLabel(d.intake.name, { exact: true })).toHaveValue(
      '',
    )
    await expect(page.getByLabel(d.intake.email, { exact: true })).toHaveValue(
      '',
    )
    await expect(page.getByLabel(d.intake.phone, { exact: true })).toHaveValue(
      '',
    )
  } finally {
    await f.close()
  }
})

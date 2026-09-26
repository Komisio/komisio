import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('store instructions persist, retain edits across steps and reject a stale editor', async ({
  page,
}, testInfo) => {
  const email = `flow-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/flow')
    await expect(
      page.getByRole('heading', { name: d.storeFlow.title, exact: true }),
    ).toBeVisible()
    const second = await page.context().newPage()
    await second.goto('/intake/flow')
    await page
      .getByLabel(d.storeFlow.localRoutine, { exact: true })
      .fill('Synthetic shelf B')
    await page
      .getByRole('button', { name: new RegExp(d.storeFlow.steps.wait.title) })
      .click()
    await page
      .getByLabel(d.storeFlow.localRoutine, { exact: true })
      .fill('Synthetic morning inspection')
    await page
      .getByRole('button', { name: d.storeFlow.save, exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(d.storeFlow.saved)
    await page.reload()
    await expect(
      page.getByLabel(d.storeFlow.localRoutine, { exact: true }),
    ).toHaveValue('Synthetic shelf B')
    await second
      .getByLabel(d.storeFlow.localRoutine, { exact: true })
      .fill('Stale text')
    await second
      .getByRole('button', { name: d.storeFlow.save, exact: true })
      .click()
    await expect(second.getByRole('status')).toHaveText(d.storeFlow.conflict)
    await expect(
      second.getByLabel(d.storeFlow.localRoutine, { exact: true }),
    ).toHaveValue('Stale text')
    await second.close()
    await page.screenshot({
      path: testInfo.outputPath('flow-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByRole('button', { name: new RegExp(d.storeFlow.steps.wait.title) })
      .click()
    await expect(page.locator('#flow-detail')).toBeFocused()
    await expect(
      page.getByLabel(d.storeFlow.localRoutine, { exact: true }),
    ).toHaveValue('Synthetic morning inspection')
    await page.getByRole('link', { name: `↑ ${d.storeFlow.title}` }).click()
    await page
      .getByRole('button', {
        name: new RegExp(d.storeFlow.steps.receive.title),
      })
      .click()
    await expect(
      page.getByRole('link', {
        name: d.storeFlow.steps.receive.action,
        exact: true,
      }),
    ).toHaveAttribute('href', '/intake')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('flow-mobile.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})

test('current flow counts actual work, refreshes without losing notes and opens matching queues', async ({
  page,
}, testInfo) => {
  const email = 'flow-now-' + randomUUID() + '@example.test'
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  try {
    const receive = async (note: string) =>
      (
        await f.db.query(
          'select receive_bag_with_agreement($1,$2,$3,$4,$5) id',
          [f.tenant, randomUUID(), f.seller, note, f.agreement],
        )
      ).rows[0].id
    const ownSeller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic announcement seller',
        email,
        '',
      ])
    ).rows[0].id
    const policy = (
      await f.db.query('select current_store_policy($1) p', [f.tenant])
    ).rows[0].p
    await f.db.query('select publish_store_policy($1,$2,$3,$4::jsonb)', [
      f.tenant,
      randomUUID(),
      policy.id,
      JSON.stringify({
        ...policy.policy,
        custodySources: ['staff_receipt', 'seller_dropoff'],
      }),
    ])
    const announcement = randomUUID(),
      cancelled = randomUUID()
    for (const id of [announcement, cancelled])
      await f.db.query(
        "select create_my_handover($1,$2,$3,'box',2,'Synthetic announcement')",
        [f.tenant, id, ownSeller],
      )
    await f.db.query('select cancel_my_handover($1,$2,$3)', [
      f.tenant,
      randomUUID(),
      cancelled,
    ])
    const untouched = await receive('Synthetic unstarted delivery')
    const started = await receive('Synthetic started delivery')
    await f.db.query('select create_bag_reception($1,$2,$3,$4)', [
      f.tenant,
      randomUUID(),
      f.seller,
      started,
    ])
    await f.item('Synthetic accepted item')
    await f.commit()
    await page.goto('/intake/flow')
    const note = page.getByLabel(d.storeFlow.localRoutine, { exact: true })
    await note.fill('Keep this unsaved routine')
    await page
      .getByRole('button', { name: d.storeFlow.live.now, exact: true })
      .click()
    const dropoffs = page.locator('[data-flow-metric="dropoffs"]')
    await expect(dropoffs.locator('.flow-count strong')).toHaveText('1')
    const announcements = page.locator('[data-flow-metric="announcements"]')
    await expect(announcements.locator('.flow-count strong')).toHaveText('1')
    await expect(announcements).toContainText(
      d.storeFlow.live.announcementsHelp,
    )
    await expect(announcements.getByRole('link')).toHaveAttribute(
      'href',
      '/intake/handovers?status=open',
    )
    await expect(announcements.locator('time')).toHaveCount(0)
    await expect(
      page.locator('[data-flow-metric="preparing"] .flow-count strong'),
    ).toHaveText('1')
    await expect(
      page.locator('[data-flow-metric="markdown_due"] .flow-count strong'),
    ).toHaveText('1')
    await expect(dropoffs.locator('time')).toHaveText(d.storeFlow.live.today)
    await expect(
      page.locator('[data-flow-metric="awaiting_seller"]'),
    ).toHaveCount(0)
    await page.getByLabel(d.storeFlow.live.showEmpty).check()
    await expect(
      page.locator('[data-flow-metric="awaiting_seller"] .flow-count strong'),
    ).toHaveText('0')
    await page.getByLabel(d.storeFlow.live.showEmpty).uncheck()
    await f.asActor(f.actor, () => receive('Synthetic new delivery'))
    await page
      .getByRole('button', { name: d.storeFlow.live.refresh, exact: true })
      .click()
    await expect(dropoffs.locator('.flow-count strong')).toHaveText('2')
    await page
      .getByRole('button', { name: d.storeFlow.live.work, exact: true })
      .click()
    await expect(note).toHaveValue('Keep this unsaved routine')
    await page
      .getByRole('button', { name: d.storeFlow.live.now, exact: true })
      .click()
    await page.screenshot({
      path: testInfo.outputPath('flow-now-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('flow-now-mobile.png'),
      fullPage: true,
    })
    await dropoffs.getByRole('link').click()
    await expect(page).toHaveURL(/state=unstarted/)
    await expect(
      page.locator(
        '#bag-queue a[href="/intake/bags/' + untouched + '/inspect"]',
      ),
    ).toBeVisible()
    await expect(
      page.locator('#bag-queue a[href="/intake/bags/' + started + '/inspect"]'),
    ).toHaveCount(0)
  } finally {
    await f.close()
  }
})

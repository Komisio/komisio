import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
const s = d.inspection
test('saved details fold away on the editable draft and stay open where they are the only record', async ({
  page,
  browser,
}) => {
  const email = `saved-details-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        f.seller,
        'Synthetic saved details',
        f.agreement,
      ])
    ).rows[0].id
    const draft = randomUUID()
    await f.db.query('select save_inspection_draft($1,$2,$3,$4,0,$5,$6,$7)', [
      f.tenant,
      randomUUID(),
      bag,
      draft,
      'Synthetic blue coat',
      'Coats',
      'Good',
    ])
    const archived = randomUUID()
    await f.db.query('select save_inspection_draft($1,$2,$3,$4,0,$5,$6,$7)', [
      f.tenant,
      randomUUID(),
      bag,
      archived,
      'Synthetic archived hat',
      'Hats',
      'Worn',
    ])
    await f.db.query(
      "select set_inspection_archived($1,$2,$3,$4,1,true,'Synthetic archive')",
      [f.tenant, randomUUID(), bag, archived],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })

    // Editable current draft: the saved record is folded, one tap opens it.
    await page.goto(`/intake/bags/${bag}/inspect?view=drafts&draft=${draft}`)
    const saved = page.getByTestId('saved-details')
    await expect(saved).toBeVisible()
    expect(await saved.evaluate((el) => el.tagName)).toBe('DETAILS')
    expect(await saved.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
      false,
    )
    await expect(saved.getByText('Synthetic blue coat')).toBeHidden()
    const summary = saved.locator('summary')
    await expect(summary).toContainText(s.savedDetails)
    await expect(summary).toContainText(`${s.version} 1`)
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(40)
    const gap = async () => {
      const save = await page
        .getByRole('button', { name: s.save, exact: true })
        .boundingBox()
      const accept = await page
        .getByRole('heading', { name: d.items.acceptHeading, exact: true })
        .boundingBox()
      return Math.round(accept!.y - (save!.y + save!.height))
    }
    const folded = await gap()
    await summary.click()
    await expect(saved.getByText('Synthetic blue coat')).toBeVisible()
    await expect(saved.getByText('Coats', { exact: true })).toBeVisible()
    await expect(saved.getByText(s.active, { exact: true })).toBeVisible()
    const expanded = await gap()
    expect(folded).toBeLessThan(expanded)
    console.log(
      `save-to-accept distance at 320px: folded ${folded}px, expanded ${expanded}px`,
    )

    // Saving a new revision shows the confirmation card and the folded record follows the new revision.
    await page.goto(`/intake/bags/${bag}/inspect?view=drafts&draft=${draft}`)
    await page
      .getByLabel(s.description, { exact: true })
      .fill('Synthetic blue coat, lined')
    await page.getByRole('button', { name: s.save, exact: true }).click()
    await expect(page.getByRole('status')).toContainText(s.saved)
    await expect(saved.locator('summary')).toContainText(`${s.version} 2`)
    await saved.locator('summary').click()
    await expect(saved.getByText('Synthetic blue coat, lined')).toBeVisible()

    // A historical version keeps the full open card.
    await page.goto(
      `/intake/bags/${bag}/inspect?view=drafts&draft=${draft}&version=1`,
    )
    expect(await saved.evaluate((el) => el.tagName)).toBe('SECTION')
    await expect(
      saved.getByRole('heading', { name: s.savedDetails }),
    ).toBeVisible()

    // An archived draft has no form and keeps the full open card.
    await page.goto(
      `/intake/bags/${bag}/inspect?view=drafts&draft=${archived}&status=archived`,
    )
    expect(await saved.evaluate((el) => el.tagName)).toBe('SECTION')
    await expect(saved.getByText('Synthetic archived hat')).toBeVisible()
    await expect(saved.getByText(s.archived, { exact: true })).toBeVisible()

    // A readonly member keeps the full open card.
    const readerEmail = `saved-details-reader-${randomUUID()}@example.test`
    const readerPassword = `K!${randomBytes(16).toString('hex')}`
    const reader = await browser.newContext({
      baseURL: 'http://127.0.0.1:3000',
    })
    try {
      const readerPage = await reader.newPage()
      // A new account without a store lands on onboarding. The helper waits
      // for that page before anything else happens, so the streamed
      // post-confirmation redirect cannot abort the next navigation (the
      // `/intake` target skipped that wait and raced it in CI).
      await register(readerPage, readerEmail, readerPassword)
      await expect(readerPage).toHaveURL(/\/onboarding$/)
      const uid = (
        await f.db.query('select id from auth.users where email=$1', [
          readerEmail,
        ])
      ).rows[0].id
      await f.db.query(
        "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'readonly')",
        [f.tenant, uid],
      )
      await readerPage.setViewportSize({ width: 320, height: 720 })
      await readerPage.goto(
        `/intake/bags/${bag}/inspect?view=drafts&draft=${draft}`,
      )
      const readerSaved = readerPage.getByTestId('saved-details')
      expect(await readerSaved.evaluate((el) => el.tagName)).toBe('SECTION')
      await expect(
        readerSaved.getByText('Synthetic blue coat, lined'),
      ).toBeVisible()
      await expect(
        readerPage.getByRole('button', { name: s.save, exact: true }),
      ).toHaveCount(0)
    } finally {
      await reader.close()
    }
  } finally {
    await f.close()
  }
})

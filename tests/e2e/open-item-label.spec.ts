import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
type Fixture = Awaited<ReturnType<typeof p2Fixture>>
async function accept(f: Fixture, id: string, title: string) {
  const bag = (
    await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
      f.tenant,
      randomUUID(),
      f.seller,
      '',
      f.agreement,
    ])
  ).rows[0].id
  const draft = randomUUID()
  await f.db.query('select save_inspection_draft($1,$2,$3,$4,0,$5,$6,$7)', [
    f.tenant,
    randomUUID(),
    bag,
    draft,
    title,
    'Jackets',
    'Good',
  ])
  await f.db.query("select accept_item($1,$2,'inspection_draft',$3,1,20000)", [
    f.tenant,
    id,
    draft,
  ])
}

test('printed item references open within the active store and collisions require a choice', async ({
  page,
}, testInfo) => {
  const email = 'item-scan-' + randomUUID() + '@example.test'
  await register(page, email, 'K!' + randomBytes(16).toString('hex'))
  const f = await p2Fixture(email)
  let other: Fixture | undefined
  try {
    const prefix = randomUUID().slice(0, 8),
      ref = 'I-' + prefix.toUpperCase()
    const id = prefix + randomUUID().slice(8)
    await accept(f, id, 'First scanning item')
    await f.commit()
    other = await p2Fixture(email)
    await accept(other, prefix + randomUUID().slice(8), 'Other store collision')
    const foreignPrefix = prefix === 'ffffffff' ? '00000000' : 'ffffffff'
    await accept(
      other,
      foreignPrefix + randomUUID().slice(8),
      'Other store only',
    )
    await other.commit()
    await f.asActor(f.actor, () =>
      f.db.query('select set_active_tenant($1)', [f.tenant]),
    )
    await page.goto('/intake/items/' + id + '/label')
    await expect(page.locator('.item-browser-label')).toContainText(ref)
    await page.goto('/intake/economy')
    const topbar = page.getByRole('search', {
      name: d.openByReference.title,
      exact: true,
    })
    await topbar
      .getByLabel(d.openByReference.reference, { exact: true })
      .fill(ref)
    await topbar
      .getByLabel(d.openByReference.reference, { exact: true })
      .press('Enter')
    await expect(page).toHaveURL('/intake/items/' + id)
    await expect(
      page.getByRole('heading', { name: 'First scanning item', exact: true }),
    ).toBeVisible()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/open')
    const scan = page
      .locator('.intake-form')
      .getByLabel(d.openByReference.reference, { exact: true })
    await scan.fill(' i' + prefix + ' ')
    await scan.press('Enter')
    await expect(page).toHaveURL('/intake/items/' + id)
    await page.goto('/intake/open?ref=I-' + foreignPrefix)
    await expect(page.locator('.intake-form').getByRole('alert')).toContainText(
      d.openByReference.notFound.replace(
        '{ref}',
        'I-' + foreignPrefix.toUpperCase(),
      ),
    )
    await f.asActor(f.actor, () =>
      accept(f, prefix + randomUUID().slice(8), 'Second scanning item'),
    )
    await page.goto('/intake/open?ref=' + ref)
    await expect(page.locator('.intake-form').getByRole('alert')).toContainText(
      d.openByReference.ambiguous.replace('{ref}', ref),
    )
    await page.screenshot({
      path: testInfo.outputPath('ambiguous-label-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole('link', { name: d.openByReference.chooseMatch, exact: true })
      .click()
    await expect(page.locator('.lifecycle-row')).toHaveCount(2)
    await expect(page.locator('.lifecycle-row[open]')).toHaveCount(0)
    await expect(page.locator('.lifecycle-list')).toContainText(
      'First scanning item',
    )
    await expect(page.locator('.lifecycle-list')).toContainText(
      'Second scanning item',
    )
    await expect(page.locator('.lifecycle-list')).not.toContainText(
      'Other store collision',
    )
  } finally {
    await f.close()
    if (other) await other.close()
  }
})

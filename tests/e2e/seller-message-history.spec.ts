import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'
import d from '../../messages/sv.json' with { type: 'json' }

test('message history pages older records while preserving the draft and seller scope', async ({
  page,
}) => {
  const email = `message-history-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const otherSeller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Other synthetic seller',
        `other-${randomUUID()}@example.test`,
        '',
      ])
    ).rows[0].id
    const queue = (seller: string, subject: string) =>
      f.db.query(
        "select queue_seller_communication($1,$2,$3,'message','synthetic-test','1','sv',$4,'Synthetic body','none',null)",
        [f.tenant, randomUUID(), seller, subject],
      )
    await queue(f.seller, 'Synthetic oldest message')
    await queue(otherSeller, 'Other seller private message')
    await f.commit()
    await f.asActor(f.actor, async () => {
      for (let i = 0; i < 48; i++)
        await queue(f.seller, `Synthetic recent message ${i}`)
    })
    await page.goto(`/intake/sellers/${f.seller}#seller-communication`)
    const history = page.locator('.seller-message-history')
    const text = page.getByLabel(d.communications.freeText, { exact: true })
    await expect(history.locator(':scope > summary')).toContainText('(49)')
    await history.locator(':scope > summary').click()
    await expect(history.locator(':scope > details')).toHaveCount(25)
    await expect(history).not.toContainText('Synthetic oldest message')
    await expect(history).not.toContainText('Other seller private message')
    await text.fill('Synthetic retained message draft')
    let dialogs = 0
    const dismiss = async (dialog: import('@playwright/test').Dialog) => {
      dialogs++
      await dialog.dismiss()
    }
    page.on('dialog', dismiss)
    await history
      .getByRole('link', { name: d.communications.older, exact: true })
      .click()
    await expect(page).toHaveURL(/messagesPage=1#seller-communication$/)
    await expect(history).toHaveAttribute('open', '')
    await expect(history.locator(':scope > details')).toHaveCount(24)
    await expect(history).toContainText('Synthetic oldest message')
    await expect(history).toContainText(
      d.communications.showingRange
        .replace('{from}', '26')
        .replace('{to}', '49')
        .replace('{total}', '49'),
    )
    await expect(
      history.getByRole('link', { name: d.communications.older, exact: true }),
    ).toHaveCount(0)
    await expect(text).toHaveValue('Synthetic retained message draft')
    await history
      .getByRole('link', { name: d.communications.newer, exact: true })
      .click()
    await expect(history.locator(':scope > details')).toHaveCount(25)
    await expect(text).toHaveValue('Synthetic retained message draft')
    expect(dialogs).toBe(0)
    page.off('dialog', dismiss)
    await text.fill('')
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const dictionary: Dictionary = JSON.parse(
        readFileSync(
          new URL(`../../messages/${locale}.json`, import.meta.url),
          'utf8',
        ),
      )
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: new URL(page.url()).origin,
        },
      ])
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(
        `/intake/sellers/${f.seller}?messagesPage=1&localeCheck=${locale}#seller-communication`,
      )
      await expect(
        history.getByRole('link', {
          name: dictionary.communications.newer,
          exact: true,
        }),
      ).toBeVisible()
      await expect(history).not.toContainText('Other seller private message')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await page.goto(
      `/intake/sellers/${f.seller}?messagesPage=999#seller-communication`,
    )
    const italian: Dictionary = JSON.parse(
      readFileSync(new URL('../../messages/it.json', import.meta.url), 'utf8'),
    )
    await expect(history).toContainText(italian.communications.pageEmpty)
    await history
      .getByRole('link', { name: italian.communications.latest, exact: true })
      .click()
    await expect(history.locator(':scope > details')).toHaveCount(25)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_communications where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(50)
  } finally {
    await f.close()
  }
})

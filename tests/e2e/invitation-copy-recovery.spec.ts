import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
const d: Dictionary = JSON.parse(
  readFileSync(new URL('../../messages/sv.json', import.meta.url), 'utf8'),
)

test('an unavailable clipboard offers manual invitation copying without sending another invitation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let calls = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          if (++calls === 2)
            throw new DOMException(
              'Synthetic clipboard refusal',
              'NotAllowedError',
            )
        },
      },
    })
  })
  const email = `invitation-copy-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/members')
    let invitations = 0
    await page.route('**/api/platform', async (route) => {
      const body = route.request().postDataJSON()
      expect(body.action).toBe('invite')
      invitations++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          inviteUrl: `${new URL(page.url()).origin}/invite/${'a'.repeat(64)}`,
          delivery: 'manual',
        }),
      })
    })
    await page.locator('#invite-email').fill('synthetic-colleague@example.test')
    await page.getByRole('button', { name: d.invite, exact: true }).click()
    const input = page.getByRole('textbox', {
      name: d.inviteReady,
      exact: true,
    })
    await expect(input).toBeVisible()
    await page.getByRole('button', { name: d.copyLink, exact: true }).click()
    await page.getByRole('button', { name: d.copied, exact: true }).click()
    await expect(input).toBeFocused()
    expect(
      await input.evaluate((el: HTMLInputElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
    ).toEqual([0, (await input.inputValue()).length])
    const notice = page.locator('.notice').filter({ has: input })
    await expect(notice.getByRole('alert')).toHaveText(d.copyLinkFailed)
    await page.getByRole('button', { name: d.copyLink, exact: true }).click()
    await expect(
      page.getByRole('button', { name: d.copied, exact: true }),
    ).toBeVisible()
    await expect(notice.getByRole('alert')).toHaveCount(0)
    expect(invitations).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from tenant_invitations where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

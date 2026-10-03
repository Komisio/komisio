import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { reviewFixture } from '../helpers/seller-review-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function openAccess(page: Page, session: string) {
  await page.goto(`/intake/reception/${session}`)
  const review = page.locator('.reception-step').nth(1)
  if (!(await review.evaluate((el) => (el as HTMLDetailsElement).open)))
    await review.locator(':scope > summary').click()
  await page
    .getByText(d.reception.storeReview.optionalShare, { exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: d.reception.replaceLink, exact: true }),
  ).toBeEnabled()
}

for (const enabled of [true, false])
  test(`an unconfirmed review link ${enabled ? 'replacement' : 'revocation'} requires inspection before another action`, async ({
    page,
  }) => {
    const { f, review, session } = await reviewFixture(page)
    try {
      await openAccess(page, session)
      const commands: Record<string, unknown>[] = []
      await page.route('**/api/reception/access', async (route) => {
        commands.push(route.request().postDataJSON())
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        if (commands.length === 1) await route.abort('failed')
        else await route.fulfill({ response })
      })
      await page
        .getByRole('button', {
          name: enabled ? d.reception.replaceLink : d.reception.revokeLink,
          exact: true,
        })
        .click()
      await expect(page.locator('main').getByRole('alert')).toBeVisible()
      await expect(
        page.getByRole('button', { name: d.reception.revokeLink, exact: true }),
      ).toBeDisabled()
      await expect(
        page.getByRole('button', {
          name: d.reception.replaceLink,
          exact: true,
        }),
      ).toBeDisabled()
      await expect(page.locator('#seller-review-link')).toHaveCount(0)
      expect(commands).toHaveLength(1)
      await page
        .getByRole('button', { name: d.reception.reload, exact: true })
        .click()
      const step = page.locator('.reception-step').nth(1)
      if (!(await step.evaluate((el) => (el as HTMLDetailsElement).open)))
        await step.locator(':scope > summary').click()
      await page
        .getByText(d.reception.storeReview.optionalShare, { exact: true })
        .click()
      const issue = page.getByRole('button', {
        name: enabled ? d.reception.replaceLink : d.reception.issueLink,
        exact: true,
      })
      await expect(issue).toBeEnabled()
      expect(
        (
          await f.db.query(
            'select count(*)::int n from reception_access_events where review_id=$1',
            [review],
          )
        ).rows[0].n,
      ).toBe(2)
      if (enabled) {
        await issue.click()
        await expect(page.locator('#seller-review-link')).toHaveValue(
          /\/review\/[a-f0-9]{64}$/,
        )
        expect(commands).toHaveLength(2)
        expect(commands[1].requestId).not.toBe(commands[0].requestId)
        expect(
          (
            await f.db.query(
              'select count(*)::int n from reception_access_events where review_id=$1',
              [review],
            )
          ).rows[0].n,
        ).toBe(3)
      } else
        await expect(
          page.getByRole('button', {
            name: d.reception.revokeLink,
            exact: true,
          }),
        ).toHaveCount(0)
    } finally {
      await f.close()
    }
  })

for (const damaged of ['id', 'path', 'revoked-path'] as const)
  test(`a malformed review link ${damaged} reply cannot leave an obsolete copyable link`, async ({
    page,
  }) => {
    const { f, review, session } = await reviewFixture(page)
    try {
      await openAccess(page, session)
      await page
        .getByRole('button', { name: d.reception.replaceLink, exact: true })
        .click()
      await expect(page.locator('#seller-review-link')).toHaveValue(
        /\/review\/[a-f0-9]{64}$/,
      )
      let commands = 0
      await page.route('**/api/reception/access', async (route) => {
        commands++
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        const body = await response.json()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...body,
            ...(damaged === 'id'
              ? { id: randomUUID() }
              : damaged === 'path'
                ? { path: '/review/not-a-token' }
                : { path: '/review/' + 'f'.repeat(64) }),
          }),
        })
      })
      await page
        .getByRole('button', {
          name:
            damaged === 'revoked-path'
              ? d.reception.revokeLink
              : d.reception.replaceLink,
          exact: true,
        })
        .click()
      await expect(page.locator('main').getByRole('alert')).toHaveText(
        d.reception.linkUncertain,
      )
      await expect(page.locator('#seller-review-link')).toHaveCount(0)
      await expect(
        page.getByRole('button', {
          name: d.reception.replaceLink,
          exact: true,
        }),
      ).toBeDisabled()
      await expect(
        page.getByRole('button', { name: d.reception.revokeLink, exact: true }),
      ).toBeDisabled()
      await expect(
        page.getByRole('button', { name: d.reception.reload, exact: true }),
      ).toBeVisible()
      expect(commands).toBe(1)
      expect(
        (
          await f.db.query(
            'select count(*)::int n from reception_access_events where review_id=$1',
            [review],
          )
        ).rows[0].n,
      ).toBe(3)
    } finally {
      await f.close()
    }
  })

test('copy failure clears old success and selects the personal link for manual copying', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let calls = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          calls++
          if (calls === 2)
            throw new DOMException(
              'Synthetic denied clipboard',
              'NotAllowedError',
            )
        },
      },
    })
  })
  const { f, review, session } = await reviewFixture(page)
  try {
    await openAccess(page, session)
    await page
      .getByRole('button', { name: d.reception.replaceLink, exact: true })
      .click()
    const input = page.locator('#seller-review-link')
    const field = page.locator('.field').filter({ has: input })
    const copy = field.getByRole('button')
    await expect(input).toBeVisible()
    await copy.click()
    await expect(copy).toHaveText(d.reception.copied)
    await copy.click()
    await expect(copy).toHaveText(d.reception.copy)
    await expect(field.getByRole('alert')).toHaveText(d.reception.copyFailed)
    await expect(input).toBeFocused()
    expect(
      await input.evaluate((el: HTMLInputElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
    ).toEqual([0, (await input.inputValue()).length])
    await copy.click()
    await expect(copy).toHaveText(d.reception.copied)
    await expect(field.getByRole('alert')).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from reception_access_events where review_id=$1',
          [review],
        )
      ).rows[0].n,
    ).toBe(2)
  } finally {
    await f.close()
  }
})

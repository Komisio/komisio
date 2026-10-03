import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function cancelDeparture(page: Page) {
  const prompt = page.waitForEvent('dialog')
  const click = page.locator('.sidebar a[href="/intake/sellers"]').click()
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toBe(d.leaveUnsaved)
  await dialog.dismiss()
  await click
}

test('answered message validation allows correction while stale access offers reload', async ({
  page,
}) => {
  const email = `message-validation-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-communication`)
    const text = page.getByLabel(d.communications.freeText, { exact: true })
    const form = page.locator('form').filter({ has: text })
    const ids: string[] = []
    await page.route('**/api/communications', async (route) => {
      ids.push(route.request().postDataJSON().requestId)
      await route.fulfill(
        ids.length === 1
          ? { status: 400, json: { error: 'INVALID_INPUT' } }
          : { status: 403, json: { error: 'FORBIDDEN' } },
      )
    })
    await text.fill('Synthetic draft')
    await form.getByRole('checkbox').check()
    await form
      .getByRole('button', { name: d.communications.send, exact: true })
      .click()
    await expect(form.getByRole('alert')).toHaveText(d.intake.invalid)
    await expect(text).toBeEnabled()
    await text.fill('Synthetic corrected draft')
    await form
      .getByRole('button', { name: d.communications.send, exact: true })
      .click()
    await expect(form.getByRole('alert')).toHaveText(d.intake.denied)
    await expect(text).toHaveValue('Synthetic corrected draft')
    await expect(text).toBeDisabled()
    await expect(
      form.getByRole('button', { name: d.intake.reload, exact: true }),
    ).toBeVisible()
    await expect(
      form.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toBeDisabled()
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_communications where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('seller message draft survives tab changes and cancelled navigation without sending', async ({
  page,
}) => {
  const email = `message-draft-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-communication`)
    const text = page.getByLabel(d.communications.freeText, { exact: true })
    await text.fill('Synthetic unsent draft')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.overview, exact: true })
      .click()
    await page
      .getByRole('tab', { name: d.sellerWorkspace.communication, exact: true })
      .click()
    await expect(text).toHaveValue('Synthetic unsent draft')
    await cancelDeparture(page)
    await expect(text).toHaveValue('Synthetic unsent draft')
    await text.fill('')
    await page.locator('.sidebar a[href="/intake/sellers"]').click()
    await expect(page).toHaveURL('/intake/sellers')
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
        `/intake/sellers/${f.seller}?localeCheck=${locale}#seller-communication`,
      )
      await expect(
        page.getByLabel(dictionary.communications.freeText, { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', {
          name: dictionary.communications.send,
          exact: true,
        }),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_communications where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('unconfirmed seller message keeps its content and ID until a matching logged outcome', async ({
  page,
}) => {
  const email = `message-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto(`/intake/sellers/${f.seller}#seller-communication`)
    const text = page.getByLabel(d.communications.freeText, { exact: true })
    const form = page.locator('form').filter({ has: text })
    const content = 'Synthetic message ' + 'x'.repeat(700)
    await text.fill(content)
    await form.getByRole('checkbox', { name: d.communications.confirm }).check()
    const payloads: { requestId: string; freeText: string }[] = []
    // Exercise real engine logging, but stub the transport boundary: no email is sent.
    await page.route('**/api/communications', async (route) => {
      const payload = route.request().postDataJSON()
      payloads.push(payload)
      await f.asActor(f.actor, async () => {
        await f.db.query(
          "select queue_seller_communication($1,$2,$3,'message','synthetic-test','1','sv','Synthetic message',$4,'none',null)",
          [f.tenant, payload.requestId, f.seller, payload.freeText],
        )
        await f.db.query(
          "select record_communication_delivery($1,$2,'manual','')",
          [f.tenant, payload.requestId],
        )
      })
      if (payloads.length === 1)
        await route.fulfill({ status: 503, json: { error: 'INVALID_INPUT' } })
      else
        await route.fulfill({
          status: 200,
          json: {
            ok: true,
            id: payloads.length === 2 ? randomUUID() : payload.requestId,
            delivery: 'manual',
          },
        })
    })
    await form
      .getByRole('button', { name: d.communications.send, exact: true })
      .click()
    await expect(form.getByRole('alert')).toBeFocused()
    await expect(text).toBeDisabled()
    await expect(text).toHaveValue(content)
    await cancelDeparture(page)
    await form
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(form.getByRole('status')).toHaveCount(0)
    await expect(text).toBeDisabled()
    await form
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(form.getByRole('status')).toHaveText(
      d.communications.outcomes.manual,
    )
    await expect(text).toBeEnabled()
    await expect(text).toHaveValue(content)
    await expect(form.getByRole('checkbox')).not.toBeChecked()
    await text.fill(content + ' edited')
    await cancelDeparture(page)
    await text.fill(content)
    expect(payloads).toHaveLength(3)
    expect(payloads[1]).toEqual(payloads[0])
    expect(payloads[2]).toEqual(payloads[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_communications where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    const history = page.locator('.seller-message-history')
    await expect(history).toBeVisible()
    await expect(history).not.toHaveAttribute('open', '')
    expect((await form.boundingBox())!.y).toBeLessThan(
      (await history.boundingBox())!.y,
    )
    await page.setViewportSize({ width: 320, height: 800 })
    await history.locator(':scope > summary').click()
    await history.locator('details summary').click()
    await expect(history.locator('pre')).toHaveText(content)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath('seller-message-recovery-320.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.locator('.sidebar a[href="/intake/sellers"]').click()
    await expect(page).toHaveURL('/intake/sellers')
  } finally {
    await f.close()
  }
})

import { test, expect } from '@playwright/test'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('store opt-in, recipient review, individual log and public unsubscribe', async ({
  page,
}) => {
  const email = `bulk-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const seller = randomUUID()
    await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
      f.tenant,
      seller,
      'Synthetic consenting seller',
      email,
      '',
    ])
    await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      'Synthetic phone seller',
      '',
      '0700000000',
    ])
    await f.db.query('select publish_store_profile($1,$2,null,$3)', [
      f.tenant,
      randomUUID(),
      {
        address: { street: '', postalCode: '', city: '' },
        contact: { email: 'store@example.test', phone: '', website: '' },
        openingHours: [],
        accepts: '',
        concept: '',
        language: 'sv',
      },
    ])
    await f.commit()
    await page.goto(`/seller?seller=${seller}#seller-workspace-details`)
    const consent = page.locator('#store-mail-consent')
    await expect(consent.getByRole('checkbox')).not.toBeChecked()
    const requests: unknown[] = []
    await page.route('**/api/store-mail', async (route) => {
      const payload = route.request().postDataJSON()
      if (payload.action !== 'consent') return route.continue()
      requests.push(payload)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      if (requests.length === 1)
        await route.fulfill({ status: 200, json: { data: randomUUID() } })
      else await route.fulfill({ response })
    })
    await consent.getByRole('checkbox').check()
    await expect(consent.getByRole('alert')).toHaveText(d.storeMail.error)
    await expect(consent.getByRole('checkbox')).toBeDisabled()
    await consent
      .getByRole('button', { name: d.intake.retry, exact: true })
      .click()
    await expect(consent.getByRole('checkbox')).toBeEnabled()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_store_mail_consents where tenant_id=$1 and seller_id=$2',
          [f.tenant, seller],
        )
      ).rows[0].n,
    ).toBe(1)
    await page.unroute('**/api/store-mail')
    await expect
      .poll(
        async () =>
          (
            await f.asActor<{ rows: { r: { enabled: boolean } }[] }>(
              f.actor,
              () =>
                f.db.query('select my_store_mail_consent($1,$2) r', [
                  f.tenant,
                  seller,
                ]),
            )
          ).rows[0].r.enabled,
      )
      .toBe(true)
    await page.goto('/intake/sellers')
    await page
      .getByRole('link', { name: d.storeMail.title, exact: true })
      .click()
    await page
      .getByLabel(d.storeMail.subject, { exact: true })
      .fill('Synthetic opening hours')
    await page
      .getByLabel(d.storeMail.body, { exact: true })
      .fill('Synthetic store information')
    await page
      .getByRole('button', { name: d.storeMail.preview, exact: true })
      .click()
    const preview = page.getByRole('region', { name: d.storeMail.preview })
    await expect(preview.getByText(d.storeMail.reviewHint)).toBeVisible()
    for (const label of [
      d.storeMail.recipients,
      d.storeMail.missingEmail,
      d.storeMail.withoutConsent,
    ]) {
      await expect(
        preview
          .locator('dl > div')
          .filter({ has: page.getByText(label, { exact: true }) })
          .locator('dd'),
      ).toHaveText('1')
    }
    await page
      .getByRole('button', { name: d.storeMail.send, exact: true })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: d.storeMail.paused }),
    ).toBeVisible()
    const history = page.getByRole('region', { name: d.storeMail.history })
    await history
      .locator('summary')
      .filter({ hasText: 'Synthetic opening hours' })
      .click()
    await expect(
      history.getByText(d.communications.outcomes.manual, { exact: true }),
    ).toBeVisible()
    await expect(
      history.getByRole('button', { name: d.storeMail.resume }),
    ).toHaveCount(0)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_communications where tenant_id=$1 and store_mail_id is not null',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    await page.screenshot({
      path: test.info().outputPath('store-mail.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 320, height: 800 })
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const translated: Dictionary = JSON.parse(
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
      await page.goto('/intake/sellers/email')
      await expect(
        page.getByLabel(translated.storeMail.subject, { exact: true }),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true)
    }
    // A synthetic recipient capability exercises the anonymous link without sending real email.
    const send = randomUUID(),
      message = randomUUID(),
      token = 'c'.repeat(64)
    await f.asActor(f.actor, async () => {
      const revision = (
        await f.db.query('select preview_store_mail($1) r', [f.tenant])
      ).rows[0].r.revision
      await f.db.query('select create_store_mail($1,$2,$3,$4,$5)', [
        f.tenant,
        send,
        'Synthetic link test',
        'Synthetic body',
        revision,
      ])
    })
    await expect
      .poll(
        async () =>
          (
            await f.asActor<{ rows: { r: { messageId?: string } }[] }>(
              f.actor,
              () =>
                f.db.query('select claim_store_mail($1,$2,$3,$4) r', [
                  f.tenant,
                  send,
                  message,
                  createHash('sha256').update(token).digest('hex'),
                ]),
            )
          ).rows[0].r.messageId,
      )
      .toBe(message)
    await page.context().clearCookies()
    await page.goto(`/unsubscribe?lang=sv#${message}.${token}`)
    expect(
      (
        await f.db.query(
          'select enabled from seller_store_mail_consents where seller_id=$1 order by seq desc limit 1',
          [seller],
        )
      ).rows[0].enabled,
    ).toBe(true)
    await page
      .getByRole('button', { name: d.storeMail.unsubscribe, exact: true })
      .click()
    await expect(
      page.getByText(d.storeMail.unsubscribed, { exact: true }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select enabled from seller_store_mail_consents where seller_id=$1 order by seq desc limit 1',
          [seller],
        )
      ).rows[0].enabled,
    ).toBe(false)
    await expect(page).not.toHaveURL(/#./)
  } finally {
    await f.close()
  }
})

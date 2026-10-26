import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register, confirmEmail } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import all from '../../messages/sv.json' with { type: 'json' }
import en from '../../messages/en.json' with { type: 'json' }
const d = all.selfRegistration

for (const automatic of [false, true])
  test(`store link, verified seller application, safe retry and staff approval (auto mail ${automatic})`, async ({
    page,
    browser,
  }, testInfo) => {
    const ownerEmail = `registration-owner-${randomUUID()}@example.test`
    await register(page, ownerEmail, `K!${randomUUID()}`)
    const f = await p2Fixture(ownerEmail)
    const sellerContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    })
    const sellerPage = await sellerContext.newPage()
    try {
      await f.db.query(
        'select publish_agreement_translation($1,$2,$3,$4,$5,$6)',
        [
          f.tenant,
          randomUUID(),
          f.agreement,
          'Synthetic translated terms',
          'Synthetic translated text',
          'sv',
        ],
      )
      await f.commit()
      await page.goto('/settings/seller-registration')
      await expect(
        page.getByRole('heading', { name: d.disabled, exact: true }),
      ).toBeVisible()
      await expect(page.getByLabel(d.link, { exact: true })).toHaveCount(0)
      if (automatic) {
        await page.getByLabel(all.storeMail.autoLabel, { exact: true }).check()
        await page
          .getByRole('button', { name: all.storeMail.save, exact: true })
          .click()
        await expect(
          page.getByRole('button', { name: all.storeMail.save, exact: true }),
        ).toBeDisabled()
      }
      await page.getByRole('button', { name: d.enable, exact: true }).click()
      const linkField = page.getByLabel(d.link, { exact: true })
      await expect(linkField).toBeVisible()
      const link = await linkField.inputValue()
      const destination = new URL(link).pathname
      await expect(
        page.getByRole('img', { name: d.qr, exact: true }),
      ).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('registration-settings.png'),
        fullPage: true,
      })
      await sellerPage.goto(destination)
      await expect(sellerPage).toHaveURL(destination)
      await expect(
        sellerPage.getByRole('heading', { name: d.applyTitle, exact: true }),
      ).toBeVisible()
      await expect(
        sellerPage.getByText(d.joinLogin, { exact: true }),
      ).toBeVisible()
      await expect(
        sellerPage.getByText(
          d.storeContext.replace('{store}', 'P2 browser store'),
          { exact: true },
        ),
      ).toBeVisible()
      await expect(
        sellerPage.getByText(/^Synthetic translated text/),
      ).toHaveCount(0)
      await expect(sellerPage.getByLabel(d.email, { exact: true })).toHaveCount(
        0,
      )
      await sellerPage.setViewportSize({ width: 360, height: 800 })
      expect(
        await sellerPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await sellerPage.screenshot({
        path: testInfo.outputPath('registration-landing-mobile.png'),
        fullPage: true,
      })
      await expect(
        sellerPage.getByRole('link', { name: all.register, exact: true }),
      ).toHaveAttribute(
        'href',
        `/register?next=${encodeURIComponent(destination)}`,
      )
      await sellerPage
        .getByRole('link', { name: all.login, exact: true })
        .click()
      await expect(sellerPage).toHaveURL(/\/login\?next=/)
      await expect(sellerPage.locator('.registration-store-name')).toHaveText(
        d.storeContext.replace('{store}', 'P2 browser store'),
      )
      expect(new URL(sellerPage.url()).searchParams.get('next')).toBe(
        destination,
      )
      await expect(
        sellerPage.getByText(d.joinLogin, { exact: true }),
      ).toBeVisible()
      await expect(
        sellerPage.getByText(all.loginIntro, { exact: true }),
      ).toHaveCount(0)
      await sellerPage
        .getByRole('link', { name: all.register, exact: true })
        .click()
      await expect(sellerPage).toHaveURL(/\/register\?next=/)
      await expect(sellerPage.locator('.registration-store-name')).toHaveText(
        d.storeContext.replace('{store}', 'P2 browser store'),
      )
      expect(new URL(sellerPage.url()).searchParams.get('next')).toBe(
        destination,
      )
      await expect(
        sellerPage.getByText(d.joinLogin, { exact: true }),
      ).toBeVisible()
      await expect(
        sellerPage.getByText(all.registerIntro, { exact: true }),
      ).toHaveCount(0)
      const sellerEmail = `registration-applicant-${randomUUID()}@example.test`
      const sellerPassword = `K!${randomUUID()}`
      await sellerPage.getByLabel(all.email, { exact: true }).fill(sellerEmail)
      await sellerPage
        .getByLabel(all.password, { exact: true })
        .fill(sellerPassword)
      await sellerPage
        .getByRole('button', { name: all.register, exact: true })
        .click()
      await expect(
        sellerPage.getByText(all.verifySent, { exact: true }),
      ).toBeVisible()
      await confirmEmail(sellerPage, sellerEmail)
      await expect(sellerPage).toHaveURL(destination)
      await expect(
        sellerPage.getByRole('heading', { name: d.applyTitle, exact: true }),
      ).toBeVisible()
      await expect(sellerPage.getByLabel(d.email, { exact: true })).toHaveValue(
        sellerEmail,
      )
      await expect(
        sellerPage.getByRole('button', { name: d.submit, exact: true }),
      ).toBeDisabled()
      await sellerPage
        .getByLabel(d.name, { exact: true })
        .fill('Synthetic applicant')
      await sellerPage.getByLabel(d.phone, { exact: true }).fill('0700000000')
      await expect(
        sellerPage.getByText(/^Synthetic translated text/),
      ).toBeVisible()
      await sellerPage.getByLabel(d.accept, { exact: true }).check()
      await sellerPage.getByLabel('Språk: Svenska', { exact: true }).click()
      await sellerPage
        .getByRole('button', { name: 'English', exact: true })
        .click()
      await expect(sellerPage.getByText(/^Only a test/)).toBeVisible()
      await expect(
        sellerPage.getByLabel(en.selfRegistration.accept, { exact: true }),
      ).not.toBeChecked()
      await sellerPage.getByLabel('Language: English', { exact: true }).click()
      await sellerPage
        .getByRole('button', { name: 'Svenska', exact: true })
        .click()
      await sellerPage
        .getByLabel(d.name, { exact: true })
        .fill('Synthetic applicant')
      await sellerPage.getByLabel(d.phone, { exact: true }).fill('0700000000')
      await sellerPage.getByLabel(d.accept, { exact: true }).check()
      await sellerPage.setViewportSize({ width: 360, height: 800 })
      expect(
        await sellerPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await sellerPage.screenshot({
        path: testInfo.outputPath('registration-form-mobile.png'),
        fullPage: true,
      })
      const attempts: unknown[] = []
      await sellerPage.route('**/api/seller-registration', async (route) => {
        if (attempts.length >= 2) return route.continue()
        attempts.push(route.request().postDataJSON())
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        await route.fulfill(
          attempts.length === 1 ? { status: 503, json: {} } : { response },
        )
      })
      await sellerPage
        .getByRole('button', { name: d.submit, exact: true })
        .click()
      await expect(sellerPage.locator('form').getByRole('alert')).toHaveText(
        d.uncertain,
      )
      await expect(
        sellerPage.getByLabel(d.name, { exact: true }),
      ).toBeDisabled()
      await sellerPage
        .getByRole('button', { name: d.retry, exact: true })
        .click()
      await expect(sellerPage).toHaveURL(/\/seller$/)
      expect(attempts).toHaveLength(2)
      expect(attempts[1]).toEqual(attempts[0])
      await expect(
        sellerPage.getByText(d.pending, { exact: true }),
      ).toBeVisible()
      await expect(
        sellerPage.getByText(all.sellerPortal.empty, { exact: true }),
      ).toHaveCount(0)
      await page.goto('/intake/sellers/registrations')
      const application = page.getByRole('article', {
        name: 'Synthetic applicant',
        exact: true,
      })
      await expect(application).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('registration-review.png'),
        fullPage: true,
      })
      await application.getByText(d.reviewTerms, { exact: true }).click()
      await expect(
        application.getByText(/^Synthetic translated text/),
      ).toBeVisible()
      await application
        .getByRole('button', { name: d.approve, exact: true })
        .click()
      await expect(page.getByText(d.empty, { exact: true })).toBeVisible()
      const rows = await f.db.query(
        'select id from sellers where tenant_id=$1 and email=$2',
        [f.tenant, sellerEmail],
      )
      expect(rows.rows).toHaveLength(1)
      await sellerContext.clearCookies()
      await sellerPage.goto(destination)
      await sellerPage
        .getByRole('link', { name: all.login, exact: true })
        .click()
      await sellerPage.getByLabel(all.email, { exact: true }).fill(sellerEmail)
      await sellerPage
        .getByLabel(all.password, { exact: true })
        .fill(sellerPassword)
      await sellerPage
        .getByRole('button', { name: all.login, exact: true })
        .click()
      await expect(sellerPage).toHaveURL(
        new RegExp(`/seller\\?seller=${rows.rows[0].id}`),
      )
      await page.goto(`/intake/sellers/${rows.rows[0].id}#seller-details`)
      await expect(
        page.getByText(
          automatic
            ? all.storeMail.statuses.automatic
            : all.storeMail.statuses.none,
          { exact: true },
        ),
      ).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('seller-mail-status.png'),
        fullPage: true,
      })
      const consent = await f.db.query(
        'select count(*)::int n from seller_store_mail_consents where tenant_id=$1 and seller_id=$2',
        [f.tenant, rows.rows[0].id],
      )
      expect(consent.rows[0].n).toBe(automatic ? 1 : 0)
      await sellerPage.locator('#store-mail-consent summary').click()
      await expect(
        sellerPage.getByText(
          automatic
            ? all.storeMail.statuses.automatic
            : all.storeMail.statuses.none,
          { exact: true },
        ),
      ).toBeVisible()
      if (automatic) {
        await sellerPage
          .getByLabel(all.storeMail.consentLabel, { exact: true })
          .uncheck()
        await sellerPage
          .locator('#store-mail-consent')
          .getByRole('button', { name: all.storeMail.save, exact: true })
          .click()
        await expect(
          sellerPage.getByText(all.storeMail.statuses.unsubscribed, {
            exact: true,
          }),
        ).toBeAttached()
        await sellerPage.locator('#store-mail-consent summary').click()
        await expect(
          sellerPage.getByText(all.storeMail.statuses.unsubscribed, {
            exact: true,
          }),
        ).toBeVisible()
      }
      // Revoked links show a clear message rather than inviting a second registration.
      await page.goto('/settings/seller-registration')
      page.once('dialog', (dialog) => dialog.accept())
      await page.getByRole('button', { name: d.rotate, exact: true }).click()
      await expect(page.getByLabel(d.link, { exact: true })).not.toHaveValue(
        link,
      )
      await sellerPage.goto(destination)
      await expect(
        sellerPage.getByText(d.unavailable, { exact: true }),
      ).toBeVisible()
      await sellerPage.setViewportSize({ width: 360, height: 800 })
      expect(
        await sellerPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
    } finally {
      await sellerContext.close()
      await f.close()
    }
  })

test('signed-out registration shell is localized and does not disclose token validity', async ({
  page,
}, testInfo) => {
  await page.context().addCookies([
    {
      name: 'komisio-locale',
      value: 'en',
      url: testInfo.project.use.baseURL!,
    },
  ])
  const destination = `/join/${'0'.repeat(64)}`
  await page.goto(destination)
  await expect(
    page.getByRole('heading', {
      name: en.selfRegistration.applyTitle,
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText(en.selfRegistration.joinLogin, { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(en.selfRegistration.unavailable, { exact: true }),
  ).toHaveCount(0)
  await page.getByRole('link', { name: en.register, exact: true }).click()
  await expect(page).toHaveURL(/\/register\?next=/)
  expect(new URL(page.url()).searchParams.get('next')).toBe(destination)
  await expect(
    page.getByText(en.selfRegistration.joinLogin, { exact: true }),
  ).toBeVisible()
  const response = await page.goto('/join/not-a-token')
  expect(response?.status()).toBe(404)
})

test('anonymous store context is plain text, revocable and never supplied by the URL', async ({
  page,
  browser,
}, testInfo) => {
  const email = `registration-context-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const visitor = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  })
  const publicPage = await visitor.newPage()
  try {
    const name = 'Synthetic <b>$&</b> ' + 'LongStoreName'.repeat(5)
    await f.db.query('select rename_tenant($1,$2)', [f.tenant, name])
    const setting = randomUUID()
    await f.db.query("select set_seller_registration($1,$2,null,'enable')", [
      f.tenant,
      setting,
    ])
    const token = (
      await f.db.query(
        "select seller_registration_settings($1)->>'token' token",
        [f.tenant],
      )
    ).rows[0].token
    await f.commit()
    const routes = (value: string) => [
      `/join/${value}`,
      `/register?next=${encodeURIComponent('/join/' + value)}&store=Forged`,
      `/login?next=${encodeURIComponent('/join/' + value)}&store=Forged`,
    ]
    await publicPage.setViewportSize({ width: 360, height: 800 })
    for (const path of routes(token)) {
      const response = await publicPage.goto(path)
      expect(response?.headers()['referrer-policy']).toBe('no-referrer')
      expect(response?.headers()['x-robots-tag']).toContain('noindex')
      await expect(publicPage.locator('.registration-store-name')).toHaveText(
        d.storeContext.replace('{store}', () => name),
      )
      await expect(
        publicPage.locator('.registration-store-name b'),
      ).toHaveCount(0)
      expect(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await publicPage.screenshot({
      path: testInfo.outputPath('store-context-mobile.png'),
    })
    const rotated = randomUUID()
    await f.asActor(f.actor, () =>
      f.db.query("select set_seller_registration($1,$2,$3,'rotate')", [
        f.tenant,
        rotated,
        setting,
      ]),
    )
    for (const path of routes(token)) {
      await publicPage.goto(path)
      await expect(publicPage.locator('.registration-store-name')).toHaveCount(
        0,
      )
      await expect(publicPage.getByText('Forged', { exact: true })).toHaveCount(
        0,
      )
    }
    const nextToken = await f.asActor(
      f.actor,
      async () =>
        (
          await f.db.query(
            "select seller_registration_settings($1)->>'token' token",
            [f.tenant],
          )
        ).rows[0].token,
    )
    await publicPage.goto(`/join/${nextToken}`)
    await expect(publicPage.locator('.registration-store-name')).toContainText(
      name,
    )
    await f.asActor(f.actor, () =>
      f.db.query("select set_seller_registration($1,$2,$3,'disable')", [
        f.tenant,
        randomUUID(),
        rotated,
      ]),
    )
    for (const value of [nextToken, 'f'.repeat(64)])
      for (const path of routes(value)) {
        await publicPage.goto(path)
        await expect(
          publicPage.locator('.registration-store-name'),
        ).toHaveCount(0)
      }
  } finally {
    await visitor.close()
    await f.close()
  }
})

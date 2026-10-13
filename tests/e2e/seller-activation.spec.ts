import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import { readFileSync } from 'node:fs'

async function activationMail(
  page: Page,
  email: string,
  frozen?: { subject: string; body: string },
) {
  let link = ''
  await expect
    .poll(async () => {
      const inbox = await (
        await page.request.get('http://127.0.0.1:54324/api/v1/messages')
      ).json()
      const message = inbox.messages?.find((m: { To: { Address: string }[] }) =>
        m.To.some((to) => to.Address === email),
      )
      if (!message) return false
      const detail = await (
        await page.request.get(
          `http://127.0.0.1:54324/api/v1/message/${message.ID}`,
        )
      ).json()
      if (frozen) {
        expect(message.Subject).toBe(frozen.subject)
        expect(
          detail.Text.replaceAll('\r\n', '\n')
            .replace(/\nhttp[^\s]*\/auth\/activate\?[^\s]*/g, '')
            .trim(),
        ).toBe(frozen.body)
        expect(detail.HTML).not.toContain('ticket=')
      }
      link = (
        detail.HTML?.match(/href="(http[^\"]*\/auth\/activate[^\"]*)"/)?.[1] ??
        ''
      ).replaceAll('&amp;', '&')
      return !!link
    })
    .toBe(true)
  return link
}

test('registration creates an unconfirmed account, activation works in another browser and preserves staff identity', async ({
  page,
  browser,
}, testInfo) => {
  const owner = `activation-owner-${randomUUID()}@example.test`
  const email = `activation-seller-${randomUUID()}@example.test`
  await register(page, owner, `K!${randomUUID()}`)
  const f = await p2Fixture(owner)
  const sellerContext = await browser.newContext()
  try {
    await f.commit()
    const command = {
      action: 'registerSeller',
      tenantId: f.tenant,
      requestId: randomUUID(),
      name: 'Activation seller',
      email,
      phone: '',
    }
    const save = () =>
      page.request.post('/api/intake', {
        headers: { origin: 'http://127.0.0.1:3000' },
        data: command,
      })
    const reply = await save()
    expect(reply.ok()).toBe(true)
    expect((await reply.json()).welcome).toMatchObject({
      ok: true,
      delivery: 'sent',
    })
    const user = (
      await f.db.query(
        'select id,email_confirmed_at,encrypted_password from auth.users where email=$1',
        [email],
      )
    ).rows[0]
    expect(user).toBeTruthy()
    expect(user.email_confirmed_at).toBeNull()
    const authCount = async () =>
      Number(
        (
          await f.db.query('select count(*) from auth.users where email=$1', [
            email,
          ])
        ).rows[0].count,
      )
    expect(await authCount()).toBe(1)
    const firstCopy = (
      await f.db.query(
        'select subject,body from seller_communications where seller_id=$1 order by queued_at desc limit 1',
        [command.requestId],
      )
    ).rows[0]
    expect(firstCopy.subject).toBe('Välkommen till P2 browser store')
    expect(firstCopy.body).toContain('Activation seller')
    const getLink = await activationMail(page, email, firstCopy)
    const replays = await Promise.all([save(), save()])
    for (const replay of replays)
      expect((await replay.json()).welcome.delivery).toBe('sent')
    expect(await authCount()).toBe(1)
    const messages = await (
      await page.request.get('http://127.0.0.1:54324/api/v1/messages')
    ).json()
    expect(
      messages.messages.filter((m: { To: { Address: string }[] }) =>
        m.To.some((to) => to.Address === email),
      ),
    ).toHaveLength(1)
    await page.goto('/account')
    await expect(page.locator('#profile-email')).toHaveValue(owner)
    const sellerPage = await sellerContext.newPage()
    const response = await sellerPage.goto(getLink)
    expect(response?.headers()['referrer-policy']).toBe('no-referrer')
    expect(
      (
        await f.db.query(
          'select email_confirmed_at from auth.users where id=$1',
          [user.id],
        )
      ).rows[0].email_confirmed_at,
    ).toBeNull()
    await sellerPage
      .getByRole('button', { name: d.sellerActivation.confirm })
      .click()
    await expect(sellerPage).toHaveURL(/\/seller\/activate$/)
    await sellerPage
      .getByLabel(d.newPassword, { exact: true })
      .fill(`K!${randomUUID()}`)
    await sellerPage
      .getByRole('button', { name: d.savePassword, exact: true })
      .click()
    await expect(sellerPage.getByText(d.saved, { exact: true })).toBeVisible()
    await sellerPage
      .getByRole('link', { name: d.sellerActivation.continue })
      .click()
    await expect(sellerPage).toHaveURL(/\/seller$/)
    expect(
      Number(
        (
          await f.db.query(
            'select count(*) from tenant_members where user_id=$1',
            [user.id],
          )
        ).rows[0].count,
      ),
    ).toBe(0)
    const passwordHash = (
      await f.db.query(
        'select encrypted_password from auth.users where id=$1',
        [user.id],
      )
    ).rows[0].encrypted_password
    expect(passwordHash).toBeTruthy()
    // An explicit resend reuses Auth identity without changing its password.
    const resend = await page.request.post('/api/communications', {
      headers: { origin: 'http://127.0.0.1:3000' },
      data: {
        tenantId: f.tenant,
        sellerId: command.requestId,
        requestId: randomUUID(),
        kind: 'message',
        welcome: true,
      },
    })
    expect(resend.ok()).toBe(true)
    expect((await resend.json()).delivery).toBe('sent')
    expect(await authCount()).toBe(1)
    expect(
      (
        await f.db.query(
          'select encrypted_password from auth.users where id=$1',
          [user.id],
        )
      ).rows[0].encrypted_password,
    ).toBe(passwordHash)
    const renewedLink = await activationMail(page, email, firstCopy)
    expect(renewedLink).not.toBe(getLink)
    await sellerContext.clearCookies()
    await sellerPage.goto(renewedLink)
    await sellerPage
      .getByRole('button', { name: d.sellerActivation.confirm })
      .click()
    await expect(sellerPage).toHaveURL(/\/seller\/activate$/)
    await sellerPage
      .getByRole('link', { name: d.sellerActivation.continue })
      .click()
    await expect(sellerPage).toHaveURL(/\/seller$/)
    expect(
      (
        await f.db.query(
          'select encrypted_password from auth.users where id=$1',
          [user.id],
        )
      ).rows[0].encrypted_password,
    ).toBe(passwordHash)
    const phoneOnly = await page.request.post('/api/intake', {
      headers: { origin: 'http://127.0.0.1:3000' },
      data: {
        ...command,
        requestId: randomUUID(),
        name: 'Phone-only seller',
        email: '',
        phone: '0700000000',
      },
    })
    expect(phoneOnly.ok()).toBe(true)
    expect((await phoneOnly.json()).welcome).toBeNull()
    const notice = (
      await f.db.query(
        'select body from seller_communications where seller_id=$1',
        [command.requestId],
      )
    ).rows
    expect(
      notice.every((row: { body: string }) => !row.body.includes('token_hash')),
    ).toBe(true)
    await sellerPage.goto(getLink)
    await sellerPage
      .getByRole('button', { name: d.sellerActivation.confirm })
      .click()
    await expect(
      sellerPage.getByRole('alert').filter({ hasText: d.callbackError }),
    ).toBeVisible()
    await sellerPage.screenshot({
      path: testInfo.outputPath('used-activation-link.png'),
    })
  } finally {
    await sellerContext.close()
    await f.close()
  }
})

test('an existing account gets the current store copy and seller language across stores', async ({
  page,
}) => {
  const owner = `branded-existing-${randomUUID()}@example.test`
  await register(page, owner, `K!${randomUUID()}`)
  const fixtures = []
  try {
    for (const locale of ['en', 'sv'] as const) {
      const f = await p2Fixture(owner)
      fixtures.push(f)
      await f.commit()
      const send = (path: string, data: object) =>
        page.request.post(path, {
          headers: { origin: 'http://127.0.0.1:3000' },
          data,
        })
      expect(
        (
          await send('/api/platform', { action: 'select', tenantId: f.tenant })
        ).ok(),
      ).toBe(true)
      const store = `Synthetic ${locale} store`
      expect(
        (
          await send('/api/platform', {
            action: 'rename',
            tenantId: f.tenant,
            name: store,
          })
        ).ok(),
      ).toBe(true)
      expect(
        (
          await send('/api/intake', {
            action: 'saveSellerProfile',
            tenantId: f.tenant,
            requestId: randomUUID(),
            sellerId: f.seller,
            expectedRevision: 0,
            profile: {
              name: 'Synthetic existing seller',
              email: owner,
              phone: '',
              addressLine1: '',
              addressLine2: '',
              postalCode: '',
              city: '',
              country: '',
              notes: '',
              language: locale,
            },
          })
        ).ok(),
      ).toBe(true)
      const metadata = (
        await f.db.query(
          'select raw_user_meta_data from auth.users where email=$1',
          [owner],
        )
      ).rows[0].raw_user_meta_data
      await page.goto(`/intake/sellers/${f.seller}#seller-communication`)
      const result = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/communications') &&
          r.request().method() === 'POST',
      )
      await page
        .getByRole('button', {
          name: d.communications.welcomeSend,
          exact: true,
        })
        .click()
      const response = await result
      expect(response.ok()).toBe(true)
      const outcome = await response.json()
      expect(outcome.delivery).toBe('sent')
      const frozen = (
        await f.db.query(
          'select subject,body from seller_communications where id=$1',
          [outcome.id],
        )
      ).rows[0]
      expect(frozen.subject).toBe(
        JSON.parse(
          readFileSync(`messages/${locale}.json`, 'utf8'),
        ).communications.welcomeSubject.replace('{store}', store),
      )
      const link = await activationMail(page, owner, frozen)
      expect(new URL(link).searchParams.get('locale')).toBe(locale)
      expect(
        (
          await f.db.query(
            'select raw_user_meta_data from auth.users where email=$1',
            [owner],
          )
        ).rows[0].raw_user_meta_data,
      ).toEqual(metadata)
    }
  } finally {
    await Promise.all(fixtures.map((f) => f.close()))
  }
})

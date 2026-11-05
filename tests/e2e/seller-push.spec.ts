import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('store independently saves push choices and plays both original sounds without submitting', async ({
  page,
}) => {
  const email = `push-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.addInitScript(() => {
      const Original = window.Audio
      const played: { src: string; duration: number }[] = []
      Object.assign(window, { pushSounds: played })
      window.Audio = function (src?: string) {
        const a = new Original(src)
        a.addEventListener('ended', () =>
          played.push({ src: a.src, duration: a.duration }),
        )
        return a
      } as unknown as typeof Audio
    })
    await page.goto('/settings#policy-section-notifications')
    const registered = page.getByRole('checkbox', {
      name: d.sellerPush.registered,
      exact: true,
    })
    const sold = page.getByRole('checkbox', {
      name: d.sellerPush.sold,
      exact: true,
    })
    await expect(registered).not.toBeChecked()
    await expect(sold).not.toBeChecked()
    await page
      .getByRole('button', {
        name: `${d.sellerPush.preview}: ${d.sellerPush.registered}`,
        exact: true,
      })
      .click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { pushSounds: unknown[] }).pushSounds.length,
        ),
      )
      .toBe(1)
    await page
      .getByRole('button', {
        name: `${d.sellerPush.preview}: ${d.sellerPush.sold}`,
        exact: true,
      })
      .click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { pushSounds: unknown[] }).pushSounds.length,
        ),
      )
      .toBe(2)
    const sounds = await page.evaluate(
      () =>
        (
          window as unknown as {
            pushSounds: { src: string; duration: number }[]
          }
        ).pushSounds,
    )
    expect(sounds[0].src).toContain('/sounds/registeredstore.wav')
    expect(sounds[0].duration).toBeCloseTo(1.614, 2)
    expect(sounds[1].src).toContain('/sounds/sale.wav')
    expect(sounds[1].duration).toBeCloseTo(2.482, 2)
    await registered.check()
    await expect(sold).not.toBeChecked()
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'publishStorePolicy',
    )
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    expect((await saved).status()).toBe(200)
    await page.reload()
    await expect(registered).toBeChecked()
    await expect(sold).not.toBeChecked()
    await registered.uncheck()
    await sold.check()
    await page.getByLabel(d.storePolicy.confirm, { exact: true }).check()
    const changed = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'publishStorePolicy',
    )
    await page
      .getByRole('button', { name: d.storePolicy.publish, exact: true })
      .click()
    expect((await changed).status()).toBe(200)
    await page.reload()
    await expect(registered).not.toBeChecked()
    await expect(sold).toBeChecked()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: 'private/push-settings-phone.png',
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    // Synthetic committed facts use the real engine and receipt commands. No
    // provider request is made by this browser test.
    const user = randomUUID(),
      session = randomUUID(),
      worker = randomUUID()
    const sellerEmail = (
      await f.db.query(
        'select email from sellers where tenant_id=$1 and id=$2',
        [f.tenant, f.seller],
      )
    ).rows[0].email
    await f.db.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),'{}'),($3,$4,now(),'{\"komisio_push_worker\":true}')",
      [user, sellerEmail, worker, `push-worker-${worker}@example.test`],
    )
    await f.db.query(
      "insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",
      [session, user],
    )
    await f.asActor(user, async () => {
      await f.db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({
          sub: user,
          role: 'authenticated',
          aal: 'aal1',
          session_id: session,
        }),
      ])
      await f.db.query(
        "select set_my_push_device($1,$2,$3,0,$4,'ios','sv',true)",
        [randomUUID(), 'b'.repeat(64), randomUUID(), `ExpoPushToken[${user}]`],
      )
    })
    const item = await f.asActor(f.actor, () => f.item('Synthetic push item'))
    await f.asActor(f.actor, () =>
      f.db.query(
        "select record_sale($1,$2,'manual','BROWSER-PUSH',now(),'SEK',$3::jsonb)",
        [
          f.tenant,
          randomUUID(),
          JSON.stringify([{ itemId: item, priceOre: 20000 }]),
        ],
      ),
    )
    const delivery = (
      await f.db.query(
        "select id from komisio_private.seller_push_deliveries where tenant_id=$1 and kind='item_sold'",
        [f.tenant],
      )
    ).rows[0].id
    await f.asActor(worker, async () => {
      await f.db.query(
        "select claim_seller_push($1,'sv','Synthetic sold notice','Synthetic frozen push body')",
        [delivery],
      )
      await f.db.query("select finish_seller_push($1,'accepted',$2,'')", [
        delivery,
        randomUUID(),
      ])
      await f.db.query("select complete_seller_push_receipt($1,'sent','')", [
        delivery,
      ])
    })
    await page.goto(
      `/intake/sellers/${f.seller}?messagesPage=0#seller-communication`,
    )
    const notice = page
      .locator('.seller-message-history summary')
      .filter({ hasText: 'Synthetic sold notice' })
    await expect(notice).toContainText(
      `${d.sellerPush.channel} · ${d.sellerPush.providerSent}`,
    )
    await notice.click()
    await expect(
      page.getByText('Synthetic frozen push body', { exact: true }),
    ).toBeVisible()
    await expect(page.locator('body')).not.toContainText('ExpoPushToken[')
  } finally {
    await f.close()
  }
})

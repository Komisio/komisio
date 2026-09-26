import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import {
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  MultiFormatReader,
} from '@zxing/library'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
test('seller code loads on demand and staff login returns to the exact handover', async ({
  page,
  browser,
}) => {
  const email = `handover-qr-${randomUUID()}@example.test`,
    password = `K!${randomBytes(16).toString('hex')}`
  await register(page, email, password)
  const f = await p2Fixture(email)
  try {
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic code seller',
        email,
        '',
      ])
    ).rows[0].id
    const current = (
      await f.db.query(
        'select id,policy from store_policy_versions where tenant_id=$1 order by version desc limit 1',
        [f.tenant],
      )
    ).rows[0]
    await f.db.query('select publish_store_policy($1,$2,$3,$4::jsonb)', [
      f.tenant,
      randomUUID(),
      current.id,
      JSON.stringify({
        ...current.policy,
        custodySources: ['staff_receipt', 'seller_dropoff'],
      }),
    ])
    const id = randomUUID()
    await f.db.query(
      "select create_my_handover($1,$2,$3,'box',2,'Synthetic code notice')",
      [f.tenant, id, seller],
    )
    const reference =
      'H-' +
      (
        await f.db.query('select reference from seller_handovers where id=$1', [
          id,
        ])
      ).rows[0].reference
    await f.commit()
    let codeRequests = 0
    const writes: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/seller/handovers/code')) codeRequests++
      if (r.method() === 'POST' && r.url().includes('/api/seller/'))
        writes.push(r.url())
    })
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/seller?seller=' + seller + '#portal-handovers')
    const receipt = page.locator('#seller-handover-' + id)
    await expect(receipt).toBeVisible()
    await expect(receipt).toContainText(
      d.sellerPortal.handoverItemCount.replace('{count}', '2'),
    )
    await expect(receipt).toContainText(d.sellerPortal.handoverStatuses.open)
    await expect(receipt.locator('time')).toHaveAttribute(
      'datetime',
      /\d{4}-\d{2}-\d{2}T/,
    )
    await receipt.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: test.info().outputPath('seller-handover-summary-mobile.png'),
      caret: 'initial',
    })
    expect(codeRequests).toBe(0)
    await receipt
      .getByText(d.sellerPortal.showHandoverCode, { exact: true })
      .click()
    const img = receipt.getByRole('img', {
      name: d.sellerPortal.handoverCodeAlt.replace('{ref}', reference),
      exact: true,
    })
    await expect(img).toBeVisible()
    await expect
      .poll(() =>
        img.evaluate(
          (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
        ),
      )
      .toBe(true)
    expect(codeRequests).toBe(1)
    const bounds = await img.boundingBox()
    expect(bounds?.width).toBeGreaterThan(190)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await img.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: test.info().outputPath('handover-qr-mobile.png'),
      caret: 'initial',
    })
    const src = await img.getAttribute('src')
    const response = await page.request.get(src!)
    expect(response.ok()).toBe(true)
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(response.headers()['content-type']).toContain('image/svg+xml')
    const { data, info } = await sharp(await response.body())
      .resize({ width: 240 })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const target = new MultiFormatReader()
      .decode(
        new BinaryBitmap(
          new HybridBinarizer(
            new RGBLuminanceSource(
              new Uint8ClampedArray(data),
              info.width,
              info.height,
            ),
          ),
        ),
      )
      .getText()
    expect(target).toBe('http://127.0.0.1:3000/scan?ref=' + reference)
    const codeUrl = new URL(src!, 'http://127.0.0.1:3000')
    codeUrl.searchParams.set('seller', f.seller)
    expect((await page.request.get(codeUrl.toString())).status()).toBe(404)
    codeUrl.searchParams.set('seller', seller)
    codeUrl.searchParams.set('tenant', randomUUID())
    expect((await page.request.get(codeUrl.toString())).status()).toBe(404)
    // The caller's own valid account pair is not enough: the handover itself
    // must be this seller's and still open. Prepare one cancelled and one
    // received handover of this seller, and an open one of another seller in
    // the same store, all through the engine.
    const cancelled = randomUUID(),
      received = randomUUID(),
      other = randomUUID()
    const otherEmail = `handover-qr-other-${randomUUID()}@example.test`
    const otherUid = randomUUID()
    await f.db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [otherUid, otherEmail],
    )
    const otherSeller = await f.asActor(f.actor, async () => {
      await f.db.query(
        "select create_my_handover($1,$2,$3,'bag',1,'Synthetic cancelled')",
        [f.tenant, cancelled, seller],
      )
      await f.db.query('select cancel_my_handover($1,$2,$3)', [
        f.tenant,
        randomUUID(),
        cancelled,
      ])
      await f.db.query(
        "select create_my_handover($1,$2,$3,'bag',1,'Synthetic received')",
        [f.tenant, received, seller],
      )
      await f.db.query("select receive_handover($1,$2,$3,'staff_receipt','')", [
        f.tenant,
        randomUUID(),
        received,
      ])
      return (
        await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
          f.tenant,
          randomUUID(),
          'Synthetic other seller',
          otherEmail,
          '',
        ])
      ).rows[0].id as string
    })
    await f.asActor(otherUid, async () => {
      await f.db.query(
        "select create_my_handover($1,$2,$3,'box',3,'Synthetic other open')",
        [f.tenant, other, otherSeller],
      )
    })
    const referenceOf = async (handoverId: string) =>
      'H-' +
      (
        await f.db.query('select reference from seller_handovers where id=$1', [
          handoverId,
        ])
      ).rows[0].reference
    codeUrl.searchParams.set('tenant', f.tenant)
    for (const [handoverId, why] of [
      [cancelled, 'cancelled handover of this seller'],
      [received, 'received handover of this seller'],
      [other, "another seller's open handover in the same store"],
    ] as const) {
      codeUrl.searchParams.set('reference', await referenceOf(handoverId))
      expect((await page.request.get(codeUrl.toString())).status(), why).toBe(
        404,
      )
    }
    codeUrl.searchParams.set('reference', reference)
    expect((await page.request.get(codeUrl.toString())).status()).toBe(200)
    expect(writes).toEqual([])
    expect(
      (
        await page.request.get(
          '/scan?ref=' + encodeURIComponent('H-1&next=https://evil.test'),
        )
      ).status(),
    ).toBe(400)
    await page.keyboard.press('Escape')
    await expect(
      receipt.getByRole('button', {
        name: d.sellerPortal.showHandoverCode,
        exact: true,
      }),
    ).toBeFocused()
    await receipt
      .getByRole('button', {
        name: d.sellerPortal.showHandoverCode,
        exact: true,
      })
      .click()
    await expect(img).toBeVisible()
    const staff = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' })
    try {
      expect((await staff.request.get(src!)).status()).toBe(401)
      const counter = await staff.newPage()
      await counter.goto(target)
      await expect.poll(() => new URL(counter.url()).pathname).toBe('/login')
      expect(new URL(counter.url()).searchParams.get('next')).toBe(
        '/intake/open?ref=' + reference,
      )
      await counter.getByLabel('E-postadress', { exact: true }).fill(email)
      await counter.getByLabel('Lösenord', { exact: true }).fill(password)
      await counter
        .getByRole('button', { name: 'Logga in', exact: true })
        .click()
      await expect(counter).toHaveURL(
        'http://127.0.0.1:3000/intake/handovers?focus=' + id,
      )
      await expect(counter.locator('#handover-' + id)).toBeFocused()
      await expect(counter.getByText('Synthetic code notice')).toBeVisible()
      expect(
        (
          await f.db.query('select status from seller_handovers where id=$1', [
            id,
          ])
        ).rows[0].status,
      ).toBe('open')
    } finally {
      await staff.close()
    }
    await receipt
      .getByText(d.sellerPortal.hideHandoverCode, { exact: true })
      .click()
    await page.route('**/api/seller/handovers/code?**', (route) =>
      route.fulfill({ status: 503, body: '' }),
    )
    await receipt
      .getByText(d.sellerPortal.showHandoverCode, { exact: true })
      .click()
    await expect(receipt.getByRole('status')).toHaveText(
      d.sellerPortal.handoverCodeError,
    )
    await expect(
      receipt.getByRole('heading', { name: reference, exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})

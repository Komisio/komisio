import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// The same photo bytes uploaded to a second reception are reported on that
// reception with a link to where they were seen first.
test('a photo uploaded before is pointed out on the new reception', async ({
  page,
}) => {
  const email = `p3-photo-dup-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    const post = (data: object) =>
      page.request.post('/api/intake', {
        headers: { Origin: 'http://127.0.0.1:3000' },
        data,
      })
    const session = async () =>
      (
        await (
          await post({
            action: 'createReception',
            tenantId: f.tenant,
            requestId: randomUUID(),
            sellerId: f.seller,
          })
        ).json()
      ).id as string
    const first = await session(),
      second = await session()
    const png = await sharp({
      create: { width: 24, height: 36, channels: 3, background: '#7a3b12' },
    })
      .png()
      .toBuffer()
    for (const id of [first, second]) {
      const upload = await page.request.post(
        `/api/reception/${id}/photo?photo=${randomUUID()}&tenant=${f.tenant}`,
        {
          headers: {
            Origin: 'http://127.0.0.1:3000',
            'Content-Type': 'image/png',
          },
          data: png,
        },
      )
      expect(upload.status()).toBe(200)
    }
    await page.goto(`/intake/reception/${second}`)
    const notice = page.getByRole('status').filter({
      hasText: d.reception.photoSeenBefore,
    })
    await expect(notice).toBeVisible()
    await expect(
      notice.getByRole('link', { name: 'Synthetic P2 seller', exact: true }),
    ).toHaveAttribute('href', `/intake/reception/${first}`)
    await page.goto(`/intake/reception/${first}`)
    await expect(
      page.getByRole('status').filter({ hasText: d.reception.photoSeenBefore }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})

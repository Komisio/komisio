import { expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import sharp from 'sharp'
import { register } from './account'
import { p2Fixture } from './p2-fixture'

export async function reviewFixture(page: Page, withPhoto = false) {
  const email = `review-recovery-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic review seller',
        email,
        '',
      ])
    ).rows[0].id
    const session = randomUUID(),
      observation = randomUUID(),
      price = randomUUID(),
      review = randomUUID()
    await f.db.query('select create_reception_session($1,$2,$3)', [
      f.tenant,
      session,
      seller,
    ])
    await f.commit()
    const token = randomBytes(32).toString('hex')
    const photoId = withPhoto ? randomUUID() : null
    let photoSource: object | null = null
    if (photoId) {
      const image = await sharp({
        create: { width: 32, height: 48, channels: 3, background: '#24649b' },
      })
        .png()
        .toBuffer()
      const uploaded = await page.request.post(
        `/api/reception/${session}/photo?tenant=${f.tenant}&photo=${photoId}`,
        {
          headers: {
            Origin: new URL(page.url()).origin,
            'Content-Type': 'image/png',
          },
          data: image,
        },
      )
      expect(uploaded.status()).toBe(200)
      photoSource = (await uploaded.json()).source
    }
    await f.asActor(f.actor, async () => {
      await f.db.query('select save_reception_sources($1,$2,$3,0,$4)', [
        f.tenant,
        randomUUID(),
        session,
        JSON.stringify([
          ...(photoSource ? [photoSource] : []),
          {
            id: observation,
            kind: 'observation',
            reference: 'Staff observation',
            observation: 'Synthetic blue coat',
          },
          {
            id: price,
            kind: 'price-evidence',
            reference: 'Staff price proposal',
            observation: 'Synthetic 250 SEK',
          },
        ]),
      ])
      await f.db.query(
        "select publish_reception_review($1,$2,$3,1,null,$4,$5,now()+interval '1 day')",
        [
          f.tenant,
          review,
          session,
          f.agreement,
          JSON.stringify({
            attributes: [
              {
                slug: 'description',
                definitionVersion: 1,
                value: 'Synthetic blue coat',
                sourceIds: [observation],
                certainty: 'observed',
              },
            ],
            price: {
              currency: 'SEK',
              amount: '250.00',
              rationale: 'Synthetic price proposal',
              sourceIds: [price],
            },
            questions: [],
          }),
        ],
      )
      await f.db.query('select set_reception_access($1,$2,$3,null,$4)', [
        f.tenant,
        randomUUID(),
        review,
        createHash('sha256').update(token).digest('hex'),
      ])
    })
    await page.goto(`/review/${token}`)
    await expect(
      page.getByText('Synthetic blue coat', { exact: true }),
    ).toBeVisible()
    return { f, review, token, photoId, session }
  } catch (error) {
    await f.close()
    throw error
  }
}

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { runPostNordSandbox } from '../../scripts/postnord-sandbox'

const directories: string[] = []
const env = {
  POSTNORD_SANDBOX_API_KEY: 'synthetic-sandbox-key',
  POSTNORD_SANDBOX_APPLICATION_ID: '1234',
  POSTNORD_SANDBOX_CUSTOMER_NUMBER: '1234567890',
}
async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), 'komisio-postnord-'))
  directories.push(directory)
  return directory
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith('komisio-postnord-')
    )
      throw new Error('Unexpected test cleanup directory')
    await rm(directory, { recursive: true, force: true })
  }
})

it('checks configuration without dispatch and never uses production credentials as fallback', async () => {
  const transport = vi.fn()
  const result = await runPostNordSandbox(
    {
      mode: 'check',
      env: {
        KOMISIO_POSTNORD_ENABLED: 'true',
        KOMISIO_POSTNORD_ENVIRONMENT: 'production',
        KOMISIO_POSTNORD_API_KEY: 'production-secret',
      },
    },
    transport,
  )
  expect(result).toMatchObject({
    configuration: 'missing-or-invalid',
    networkRequests: 0,
  })
  expect(JSON.stringify(result)).not.toContain('production-secret')
  expect(
    await runPostNordSandbox({ mode: 'check', env }, transport),
  ).toMatchObject({ configuration: 'ready' })
  expect(transport).not.toHaveBeenCalled()
})

it('allows an unassigned application ID without reporting it as missing', async () => {
  const result = await runPostNordSandbox({
    mode: 'check',
    env: { ...env, POSTNORD_SANDBOX_APPLICATION_ID: '' },
  })
  expect(result).toMatchObject({
    configuration: 'ready',
    missing: [],
    networkRequests: 0,
  })
})

it('holds an unknown outcome durably and refuses a second or concurrent dispatch', async () => {
  const root = await workspace()
  const transport = vi
    .fn()
    .mockRejectedValue(new Error('secret credential in a provider URL'))
  const options = {
    mode: 'book' as const,
    runId: 'lost-reply',
    env,
    workspace: root,
  }
  const results = await Promise.allSettled([
    runPostNordSandbox(options, transport),
    runPostNordSandbox(options, transport),
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(results.find((r) => r.status === 'fulfilled')).toMatchObject({
    value: { status: 'unconfirmed', httpStatus: null },
  })
  await expect(runPostNordSandbox(options, transport)).rejects.toMatchObject({
    code: 'EEXIST',
  })
  const inspected = await runPostNordSandbox(
    { ...options, mode: 'inspect', env: {} },
    transport,
  )
  expect(inspected).toMatchObject({ result: { status: 'unconfirmed' } })
  expect(JSON.stringify(inspected)).not.toContain('secret credential')
  expect(transport).toHaveBeenCalledTimes(1)
})

it('records an access refusal without exposing the carrier response or trying again', async () => {
  const root = await workspace()
  const transport = vi
    .fn()
    .mockResolvedValue(
      Response.json({ error: env.POSTNORD_SANDBOX_API_KEY }, { status: 403 }),
    )
  expect(
    await runPostNordSandbox(
      { mode: 'book', runId: 'forbidden', env, workspace: root },
      transport,
    ),
  ).toMatchObject({ status: 'unconfirmed', httpStatus: 403 })
  const saved = await readFile(
    path.join(root, 'private/postnord-sandbox/forbidden/result.json'),
    'utf8',
  )
  expect(saved).not.toContain(env.POSTNORD_SANDBOX_API_KEY)
  expect(transport).toHaveBeenCalledTimes(1)
})

it('uses the real adapter in sandbox and saves only a validated QR response', async () => {
  const root = await workspace()
  const png = await sharp({
    create: { width: 128, height: 128, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer()
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://atapi2.postnord.com')
      expect(url.searchParams.get('smsQRcode')).toBe('false')
      expect(url.searchParams.get('emailQRcode')).toBe('false')
      expect(init?.redirect).toBe('error')
      const body = JSON.parse(String(init?.body))
      expect(body.shipment[0].service).toEqual({
        basicServiceCode: '24',
        additionalServiceCode: ['C2'],
      })
      expect(
        body.shipment[0].parties.consignor.party.contact.emailAddress,
      ).toBe('sender@example.test')
      return Response.json(
        {
          bookingResponse: {
            bookingId: 'test-booking',
            idInformation: [
              {
                status: 'OK',
                ids: [
                  { idType: 'returnId', value: 'test-return' },
                  { idType: 'itemId', value: '1234567890' },
                ],
                references: {
                  shipment: [{ referenceType: 'CU', referenceNo: 'H-1' }],
                },
              },
            ],
          },
          labelPrintout: [
            {
              itemIds: [{ itemIds: '1234567890', status: 'OK' }],
              printout: {
                labelFormat: 'PNG',
                encoding: 'base64',
                type: 'QRCODE',
                dataValue: 'test-return',
                data: png.toString('base64'),
              },
            },
          ],
        },
        { status: 201 },
      )
    })
  expect(
    await runPostNordSandbox(
      { mode: 'book', runId: 'accepted', env, workspace: root },
      transport,
    ),
  ).toMatchObject({ status: 'confirmed', httpStatus: 201 })
  expect(
    await readFile(path.join(root, 'private/postnord-sandbox/accepted/qr.png')),
  ).toEqual(png)
  expect(transport).toHaveBeenCalledTimes(1)
})

it('rejects paths outside the private run directory before dispatch', async () => {
  const transport = vi.fn()
  await expect(
    runPostNordSandbox({ mode: 'book', runId: '../escape', env }, transport),
  ).rejects.toThrow()
  expect(transport).not.toHaveBeenCalled()
})

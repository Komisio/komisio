import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bookCentralParcel,
  type CentralParcel,
} from '../../lib/engine/central-parcel-schema'
import { executeCentralParcel } from '../../lib/engine/central-parcels'
import {
  bookPostNordReturn,
  parsePostNordBooking,
  postNordConfiguration,
  postNordReturnBody,
} from '../../lib/platform/postnord'

const id = 'f7800000-0000-4000-8000-000000000601',
  offer = 'f7800000-0000-4000-8000-000000000401'
const contact = {
  name: 'Synthetic sender',
  street: 'Testvägen 2',
  postalCode: '12345',
  city: 'Teststad',
  country: 'SE' as const,
  email: 'sender@example.test',
  phone: '+46700007802',
}
const config = {
  environment: 'sandbox' as const,
  apiKey: 'synthetic-api-key',
  applicationId: '1234',
  customerNumber: '1234567890',
  serverKey: '7'.repeat(64),
}
const parcel: CentralParcel = {
  id,
  reference: 'P-1',
  environment: 'sandbox',
  sender: contact,
  recipient: {
    ...contact,
    name: 'Synthetic company',
    street: 'Testgatan 1',
    email: 'receiver@example.test',
  },
  weightG: 1001,
  lengthMm: 400,
  widthMm: 300,
  heightMm: 200,
  status: 'pending',
  booking: null,
  createdAt: '2026-11-12T10:00:00.000Z',
}
const command = {
  action: 'book',
  requestId: id,
  offerId: offer,
  address: {
    street: contact.street,
    postalCode: contact.postalCode,
    city: contact.city,
  },
  weightG: 1001,
  lengthMm: 400,
  widthMm: 300,
  heightMm: 200,
}
async function reply() {
  const png = await sharp({
    create: { width: 128, height: 128, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer()
  return {
    bookingResponse: {
      bookingId: 'synthetic-booking',
      idInformation: [
        {
          status: 'OK',
          ids: [
            { idType: 'returnId', value: 'synthetic-return' },
            { idType: 'itemId', value: '003700000000000001' },
          ],
          references: {
            shipment: [{ referenceType: 'CU', referenceNo: 'H-1' }],
          },
        },
      ],
    },
    labelPrintout: [
      {
        itemIds: [{ itemIds: '003700000000000001', status: 'OK' }],
        printout: {
          labelFormat: 'PNG',
          encoding: 'base64',
          type: 'QRCODE',
          dataValue: 'synthetic-return',
          data: png.toString('base64'),
        },
      },
    ],
  }
}
describe('central parcel boundary', () => {
  it('omits unknown measurements entirely while preserving legacy payloads', () => {
    const { weightG, lengthMm, widthMm, heightMm, ...simple } = command
    expect(bookCentralParcel.parse(simple)).toEqual(simple)
    for (const extra of [
      { weightG },
      { lengthMm, widthMm, heightMm },
      { weightG: null },
    ])
      expect(bookCentralParcel.safeParse({ ...simple, ...extra }).success).toBe(
        false,
      )
    const shipment = postNordReturnBody(
      config,
      {
        ...parcel,
        weightG: null,
        lengthMm: null,
        widthMm: null,
        heightMm: null,
      },
      'H-1',
      'K1',
    ).shipment[0]
    expect(shipment).not.toHaveProperty('totalGrossWeight')
    expect(shipment.goodsItem[0].items[0]).toEqual({
      itemIdentification: { itemId: '0' },
    })
  })
  it('rejects payer/recipient injection, overweight and oversized parcels', () => {
    expect(bookCentralParcel.safeParse(command).success).toBe(true)
    for (const extra of [
      { recipient: contact },
      { customerNumber: 'other' },
      { weightG: 20001 },
      { weightG: 1.5 },
      { lengthMm: 1500, widthMm: 1000, heightMm: 1000 },
      { address: { ...command.address, country: 'DE' } },
      { address: { ...command.address, street: 'A'.repeat(51) } },
      { address: { ...command.address, city: 'A'.repeat(36) } },
    ])
      expect(
        bookCentralParcel.safeParse({ ...command, ...extra }).success,
      ).toBe(false)
  })
  it('is disabled without complete server configuration', () => {
    expect(postNordConfiguration({})).toBeNull()
    expect(
      postNordConfiguration({
        KOMISIO_POSTNORD_ENABLED: 'true',
        KOMISIO_POSTNORD_ENVIRONMENT: 'production',
      }),
    ).toBeNull()
  })
  it('uses the actual sender and configured recipient and payer, not seller compensation', () => {
    const body = postNordReturnBody(config, parcel, 'H-1', 'K1')
    const shipment = body.shipment[0]
    expect(body.messageId.length).toBeLessThanOrEqual(14)
    expect(body.application.applicationId).toBe(1234)
    expect(shipment.parties.consignor.party.nameIdentification.name).toBe(
      contact.name,
    )
    expect(shipment.parties.consignee.party.address.streets).toEqual([
      'Testgatan 1',
    ])
    expect(shipment.parties.consignor.partyIdentification.partyId).toBe(
      config.customerNumber,
    )
    expect(shipment.service).toEqual({
      basicServiceCode: '24',
      additionalServiceCode: ['C2'],
    })
    expect(shipment.totalGrossWeight).toEqual({ value: 1.001, unit: 'KGM' })
    expect(shipment.goodsItem[0].items[0]).toEqual({
      itemIdentification: { itemId: '0' },
      grossWeight: { value: 1.001, unit: 'KGM' },
      dimensions: {
        length: { value: 40, unit: 'CMT' },
        width: { value: 30, unit: 'CMT' },
        height: { value: 20, unit: 'CMT' },
      },
    })
    expect(() =>
      postNordReturnBody(
        { ...config, environment: 'production' },
        parcel,
        'H-1',
        'K1',
      ),
    ).toThrow('SHIPPING_UNAVAILABLE')
  })
  it('omits an unassigned application ID in both environments without a fallback', async () => {
    for (const environment of ['sandbox', 'production'] as const) {
      for (const applicationId of [undefined, '', '   ']) {
        const parsed = postNordConfiguration({
          KOMISIO_POSTNORD_ENABLED: 'true',
          KOMISIO_POSTNORD_ENVIRONMENT: environment,
          KOMISIO_POSTNORD_API_KEY: config.apiKey,
          KOMISIO_POSTNORD_CUSTOMER_NUMBER: config.customerNumber,
          KOMISIO_SHIPPING_SERVER_KEY: config.serverKey,
          KOMISIO_POSTNORD_APPLICATION_ID: applicationId,
        })
        expect(parsed).not.toBeNull()
        const transport = vi
          .fn()
          .mockResolvedValue(Response.json(await reply()))
        await bookPostNordReturn(
          parsed!,
          { ...parcel, environment },
          'H-1',
          'K1',
          transport,
        )
        expect(transport).toHaveBeenCalledTimes(1)
        const [url, init] = transport.mock.calls[0]
        expect(url.origin).toBe(
          environment === 'sandbox'
            ? 'https://atapi2.postnord.com'
            : 'https://api2.postnord.com',
        )
        expect(JSON.parse(init.body).application).toEqual({
          name: 'Komisio',
          version: '1.0',
        })
      }
    }
  })
  it('refuses malformed configured application IDs instead of silently omitting them', () => {
    for (const applicationId of ['Komisio', '12345', '-1', '12.5']) {
      expect(
        postNordConfiguration({
          KOMISIO_POSTNORD_ENABLED: 'true',
          KOMISIO_POSTNORD_ENVIRONMENT: 'production',
          KOMISIO_POSTNORD_API_KEY: config.apiKey,
          KOMISIO_POSTNORD_CUSTOMER_NUMBER: config.customerNumber,
          KOMISIO_SHIPPING_SERVER_KEY: config.serverKey,
          KOMISIO_POSTNORD_APPLICATION_ID: applicationId,
        }),
      ).toBeNull()
    }
  })
  it('binds provider QR, item and customer reference before exposing the code', async () => {
    const response = await reply()
    expect((await parsePostNordBooking(response, 'H-1')).trackingId).toBe(
      '003700000000000001',
    )
    await expect(parsePostNordBooking(response, 'H-2')).rejects.toThrow()
    response.labelPrintout[0].printout.dataValue = 'another-return'
    await expect(parsePostNordBooking(response, 'H-1')).rejects.toThrow()
    response.labelPrintout[0].printout.dataValue = 'synthetic-return'
    response.labelPrintout[0].printout.data = Buffer.from(
      '<svg onload="alert(1)"/>',
    ).toString('base64')
    await expect(parsePostNordBooking(response, 'H-1')).rejects.toThrow()
  })
  it('posts once to a fixed sandbox host without carrier email/SMS or redirects', async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(await reply()))
    await bookPostNordReturn(config, parcel, 'H-1', 'K1', transport)
    const [url, init] = transport.mock.calls[0]
    expect(url.origin).toBe('https://atapi2.postnord.com')
    expect(url.pathname).toBe('/rest/shipment/v3/returns/edi')
    expect(url.searchParams.get('smsQRcode')).toBe('false')
    expect(url.searchParams.get('emailQRcode')).toBe('false')
    expect(url.searchParams.get('generateQrcodeImage')).toBe('true')
    expect(url.searchParams.get('qrCodeFormat')).toBe('PNG')
    expect(url.searchParams.get('functionality')).toBe('STANDARD')
    expect(url.searchParams.get('definePrintout')).toBe('onlyQRCode')
    expect(init.redirect).toBe('error')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('never redispatches a saved claim, including lost first replies', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { dispatch: false, parcel }, error: null })
    const transport = vi.fn()
    expect(
      await executeCentralParcel(
        { rpc } as unknown as SupabaseClient,
        command,
        config,
        transport,
      ),
    ).toEqual({ id })
    expect(transport).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('records an unknown outcome after a timeout without assuming a rejected booking', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          dispatch: true,
          parcel,
          messageId: 'K1',
          handoverReference: 'H-1',
        },
        error: null,
      })
      .mockResolvedValue({ data: null, error: null })
    const transport = vi
      .fn()
      .mockRejectedValue(new Error('timeout containing provider secret'))
    expect(
      await executeCentralParcel(
        { rpc } as unknown as SupabaseClient,
        command,
        config,
        transport,
      ),
    ).toEqual({ id })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenLastCalledWith('finish_central_parcel', {
      p_id: id,
      p_result: null,
    })
  })
  it('does not call the provider when SQL rejects ownership or the feature is disabled', async () => {
    const rpc = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'FORBIDDEN' } }),
      transport = vi.fn()
    await expect(
      executeCentralParcel(
        { rpc } as unknown as SupabaseClient,
        command,
        config,
        transport,
      ),
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      executeCentralParcel(
        { rpc } as unknown as SupabaseClient,
        command,
        null,
        transport,
      ),
    ).rejects.toThrow('SHIPPING_UNAVAILABLE')
    expect(transport).not.toHaveBeenCalled()
  })
})

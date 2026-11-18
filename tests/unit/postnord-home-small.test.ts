import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import {
  BinaryBitmap,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bookPostNordParcel,
  bookPostNordReturn,
  parsePostNordHomeSmallBooking,
} from '../../lib/platform/postnord'
import {
  bookCentralParcel,
  centralParcel,
  type CentralParcel,
} from '../../lib/engine/central-parcel-schema'
import { executeCentralParcel } from '../../lib/engine/central-parcels'

const code = 'RSAPN0100SYNTHETIC'
function reply() {
  return {
    bookingId: 'synthetic-booking',
    idInformation: [
      {
        status: 'OK',
        references: {
          shipment: [{ referenceType: 'CU', referenceNo: 'H-1' }],
          item: [{ referenceType: 'ALQ', referenceNo: code }],
        },
        ids: [{ idType: 'itemId', value: '003700000000000001' }],
        urls: [
          {
            type: 'QRCODE',
            url: `https://atapi2.postnord.com/booking/${code}`,
          },
        ],
      },
    ],
  }
}
const contact = {
  name: 'Synthetic',
  street: 'Testgatan 1',
  city: 'Teststad',
  postalCode: '12345',
  country: 'SE' as const,
  phone: '+46700000000',
  email: 'synthetic@example.test',
}
const parcel: CentralParcel = {
  id: 'f7800000-0000-4000-8000-000000000601',
  reference: 'P-1',
  environment: 'sandbox',
  serviceCode: '11',
  estimatedWeightG: 1400,
  sender: contact,
  recipient: { ...contact, name: 'Synthetic company' },
  items: [],
  weightG: null,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  createdAt: '2026-11-16T10:00:00Z',
  status: 'pending',
  booking: null,
}
const config = {
  environment: 'sandbox' as const,
  apiKey: 'synthetic-test-key',
  applicationId: '1234',
  customerNumber: '1234567890',
  serverKey: '7'.repeat(64),
}
const command = {
  action: 'book',
  requestId: parcel.id,
  offerId: 'f7800000-0000-4000-8000-000000000401',
  address: {
    firstName: 'Alex',
    lastName: 'Example',
    phone: contact.phone,
    street: contact.street,
    city: contact.city,
    postalCode: contact.postalCode,
  },
}

describe('PostNord Home Small Print Label', () => {
  it.each([101, 450, 2600, 3000])(
    'sends the frozen %s g estimate, including light and historical parcels',
    async (grams) => {
      const saved = centralParcel.parse({ ...parcel, estimatedWeightG: grams })
      const transport = vi.fn().mockResolvedValue(Response.json(reply()))
      await bookPostNordParcel(config, saved, 'H-1', 'K1', transport)
      const body = JSON.parse(transport.mock.calls[0][1].body)
      expect(body.shipment[0].totalGrossWeight).toEqual({
        value: grams / 1000,
        unit: 'KGM',
      })
      expect(body.shipment[0].goodsItem[0].items[0].grossWeight).toEqual({
        value: grams / 1000,
        unit: 'KGM',
      })
    },
  )
  it('produces a scannable QR containing the carrier ALQ code with the existing wire shape', async () => {
    const booking = await parsePostNordHomeSmallBooking(
      reply(),
      'H-1',
      'sandbox',
    )
    expect(Object.keys(booking).sort()).toEqual([
      'bookingId',
      'qrPng',
      'returnId',
      'trackingId',
    ])
    expect(booking.returnId).toBe(code)
    const { data, info } = await sharp(
      Buffer.from(booking.qrPng.split(',')[1], 'base64'),
    )
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const text = new MultiFormatReader()
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
    expect(text).toBe(code)
  })
  it('refuses unrelated, ambiguous, wrong-environment or unsafe carrier replies', async () => {
    const invalid = [
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].status = 'FAIL'
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation.push(r.idInformation[0])
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].references.shipment[0].referenceNo = 'H-2'
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].references.item.push({
          referenceType: 'ALQ',
          referenceNo: 'other',
        })
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].ids.push(r.idInformation[0].ids[0])
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].ids[0].idType = 'returnId'
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].urls[0].url = `https://api2.postnord.com/booking/${code}`
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].urls[0].url = 'https://attacker.test/booking/code'
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].urls[0].url += '?next=untrusted'
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].references.item[0].referenceNo = '<script>'
      },
      (r: ReturnType<typeof reply>) => {
        r.idInformation[0].urls = []
      },
    ]
    for (const mutate of invalid) {
      const r = reply()
      mutate(r)
      await expect(
        parsePostNordHomeSmallBooking(r, 'H-1', 'sandbox'),
      ).rejects.toThrow()
    }
  })
  it('dispatches Home Small once through ordinary EDI and does not fetch arbitrary QR URLs', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(Response.json(reply(), { status: 201 }))
    await bookPostNordParcel(config, parcel, 'H-1', 'K1', transport)
    expect(transport).toHaveBeenCalledTimes(1)
    const [url, init] = transport.mock.calls[0]
    expect(url.origin).toBe('https://atapi2.postnord.com')
    expect(url.pathname).toBe('/rest/shipment/v3/edi')
    expect(init.redirect).toBe('error')
    const body = JSON.parse(init.body)
    expect(body.shipment[0].service).toEqual({
      basicServiceCode: '11',
      additionalServiceCode: ['C2'],
    })
    expect(body.shipment[0].parties.consignor.partyIdentification.partyId).toBe(
      config.customerNumber,
    )
    expect(
      body.shipment[0].parties.consignee.party.nameIdentification.name,
    ).toBe('Synthetic company')
    expect(body.shipment[0].totalGrossWeight).toEqual({
      value: 1.4,
      unit: 'KGM',
    })
    await expect(
      bookPostNordReturn(config, parcel, 'H-1', 'K1', transport),
    ).rejects.toThrow('SHIPPING_UNAVAILABLE')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('does not let the mobile caller choose or inject a service', () => {
    expect(
      bookCentralParcel.safeParse({ ...command, serviceCode: '11' }).success,
    ).toBe(false)
  })
  it('uses the pinned database service and records exactly one Home Small result', async () => {
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
      .mockResolvedValue(Response.json(reply(), { status: 201 }))
    await executeCentralParcel(
      { rpc } as unknown as SupabaseClient,
      command,
      config,
      transport,
    )
    expect(transport).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenLastCalledWith('finish_central_parcel', {
      p_id: parcel.id,
      p_result: expect.objectContaining({ returnId: code }),
    })
  })
  it('holds an unconfirmed Home Small claim without retrying as Return', async () => {
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
    const transport = vi.fn().mockRejectedValue(new Error('timeout'))
    await executeCentralParcel(
      { rpc } as unknown as SupabaseClient,
      command,
      config,
      transport,
    )
    expect(transport).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenLastCalledWith('finish_central_parcel', {
      p_id: parcel.id,
      p_result: null,
    })
  })
})

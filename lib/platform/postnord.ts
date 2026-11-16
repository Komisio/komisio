import { z } from 'zod'
import sharp from 'sharp'
import { toSVG } from '@bwip-js/generic'
import {
  parcelBooking,
  type CentralParcel,
  type ParcelBooking,
} from '../engine/central-parcel-schema'

const configuration = z.object({
  environment: z.enum(['sandbox', 'production']),
  apiKey: z.string().min(8).max(512),
  applicationId: z
    .string()
    .regex(/^[0-9]{1,4}$/)
    .optional(),
  customerNumber: z.string().regex(/^[0-9]{1,17}$/),
  serverKey: z.string().regex(/^[a-f0-9]{64}$/),
})
export type PostNordConfiguration = z.infer<typeof configuration>
export function postNordConfiguration(
  env: Record<string, string | undefined> = process.env,
): PostNordConfiguration | null {
  if (env.KOMISIO_POSTNORD_ENABLED !== 'true') return null
  const parsed = configuration.safeParse({
    environment: env.KOMISIO_POSTNORD_ENVIRONMENT,
    apiKey: env.KOMISIO_POSTNORD_API_KEY,
    applicationId: env.KOMISIO_POSTNORD_APPLICATION_ID?.trim() || undefined,
    customerNumber: env.KOMISIO_POSTNORD_CUSTOMER_NUMBER,
    serverKey: env.KOMISIO_SHIPPING_SERVER_KEY,
  })
  return parsed.success ? parsed.data : null
}

/** PostNord Booking v3, "Book Return using EDI". Not a pickup or home collection.
 * Booking 3.5.29.1 Swagger requires application.name, but not applicationId.
 * Include an assigned ID when configured; never substitute a documentation ID.
 */
export function postNordReturnBody(
  config: PostNordConfiguration,
  parcel: CentralParcel,
  handoverReference: string,
  messageId: string,
) {
  if (
    parcel.environment !== config.environment ||
    !/^H-[1-9][0-9]{0,11}$/.test(handoverReference) ||
    !/^K[1-9][0-9]{0,11}$/.test(messageId)
  )
    throw new Error('SHIPPING_UNAVAILABLE')
  function party(contact: CentralParcel['sender']) {
    return {
      nameIdentification: { name: contact.name },
      address: {
        streets: [contact.street],
        postalCode: contact.postalCode,
        city: contact.city,
        countryCode: contact.country,
      },
      contact: {
        emailAddress: contact.email,
        phoneNo: contact.phone,
        smsNo: contact.phone,
      },
    }
  }
  return {
    messageDate: parcel.createdAt,
    messageFunction: 'Instruction',
    messageId,
    application: {
      ...(config.applicationId === undefined
        ? {}
        : { applicationId: Number(config.applicationId) }),
      name: 'Komisio',
      version: '1.0',
    },
    language: 'SV',
    updateIndicator: 'Original',
    shipment: [
      {
        shipmentIdentification: { shipmentId: '0' },
        dateAndTimes: { loadingDate: parcel.createdAt },
        service: { basicServiceCode: '24', additionalServiceCode: ['C2'] },
        numberOfPackages: { value: 1 },
        ...(parcel.weightG === null
          ? {}
          : {
              totalGrossWeight: { value: parcel.weightG / 1000, unit: 'KGM' },
            }),
        references: [{ referenceNo: handoverReference, referenceType: 'CU' }],
        parties: {
          // The person sends the parcel; the contracted customer number pays.
          consignor: {
            issuerCode: 'Z12',
            partyIdentification: {
              partyId: config.customerNumber,
              partyIdType: '160',
            },
            party: party(parcel.sender),
          },
          consignee: { party: party(parcel.recipient) },
        },
        goodsItem: [
          {
            marking: handoverReference,
            goodsDescription: 'Second-hand item',
            packageTypeCode: 'PC',
            items: [
              {
                itemIdentification: { itemId: '0' },
                ...(parcel.weightG === null
                  ? {}
                  : {
                      grossWeight: {
                        value: parcel.weightG / 1000,
                        unit: 'KGM',
                      },
                    }),
                ...(parcel.lengthMm === null ||
                parcel.widthMm === null ||
                parcel.heightMm === null
                  ? {}
                  : {
                      dimensions: {
                        length: { value: parcel.lengthMm / 10, unit: 'CMT' },
                        width: { value: parcel.widthMm / 10, unit: 'CMT' },
                        height: { value: parcel.heightMm / 10, unit: 'CMT' },
                      },
                    }),
              },
            ],
          },
        ],
      },
    ],
  }
}

const providerReply = z.object({
  bookingResponse: z.object({
    bookingId: z.union([z.string(), z.number().int()]).transform(String),
    idInformation: z
      .array(
        z.object({
          status: z.literal('OK'),
          ids: z
            .array(z.object({ idType: z.string(), value: z.string() }))
            .max(10),
          references: z.object({
            shipment: z
              .array(
                z.object({
                  referenceNo: z.string(),
                  referenceType: z.string(),
                }),
              )
              .max(20),
          }),
        }),
      )
      .length(1),
  }),
  labelPrintout: z
    .array(
      z.object({
        itemIds: z
          .array(z.object({ itemIds: z.string(), status: z.literal('OK') }))
          .length(1),
        printout: z.object({
          labelFormat: z.literal('PNG'),
          encoding: z.literal('base64'),
          type: z.literal('QRCODE'),
          dataValue: z.string(),
          data: z.string().max(98200),
        }),
      }),
    )
    .length(1),
})
export async function parsePostNordBooking(
  value: unknown,
  reference: string,
): Promise<ParcelBooking> {
  const r = providerReply.parse(value),
    info = r.bookingResponse.idInformation[0],
    label = r.labelPrintout[0]
  const ids = (type: string) => info.ids.filter((id) => id.idType === type)
  if (
    ids('returnId').length !== 1 ||
    ids('itemId').length !== 1 ||
    !info.references.shipment.some(
      (r) => r.referenceType === 'CU' && r.referenceNo === reference,
    )
  )
    throw new Error('INVALID_PROVIDER_RESPONSE')
  const returnId = ids('returnId')[0].value,
    trackingId = ids('itemId')[0].value
  if (
    label.printout.dataValue !== returnId ||
    label.itemIds[0].itemIds !== trackingId ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(label.printout.data)
  )
    throw new Error('INVALID_PROVIDER_RESPONSE')
  const buffer = Buffer.from(label.printout.data, 'base64')
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw new Error('INVALID_PROVIDER_RESPONSE')
  const meta = await sharp(buffer, { limitInputPixels: 1048576 }).metadata()
  if (
    meta.format !== 'png' ||
    !meta.width ||
    !meta.height ||
    meta.width > 1024 ||
    meta.height > 1024 ||
    (meta.pages ?? 1) !== 1
  )
    throw new Error('INVALID_PROVIDER_RESPONSE')
  return parcelBooking.parse({
    bookingId: r.bookingResponse.bookingId,
    returnId,
    trackingId,
    qrPng: `data:image/png;base64,${label.printout.data}`,
  })
}

export async function bookPostNordReturn(
  config: PostNordConfiguration,
  parcel: CentralParcel,
  reference: string,
  messageId: string,
  transport: typeof fetch = fetch,
) {
  if (parcel.serviceCode && parcel.serviceCode !== '24')
    throw new Error('SHIPPING_UNAVAILABLE')
  return dispatchPostNord(config, parcel, reference, messageId, transport, '24')
}

/** Select the adapter from the immutable claim, never from mutable runtime/env. */
export async function bookPostNordParcel(
  config: PostNordConfiguration,
  parcel: CentralParcel,
  reference: string,
  messageId: string,
  transport: typeof fetch = fetch,
) {
  const service = parcel.serviceCode ?? '24'
  if (service !== '11' && service !== '24')
    throw new Error('SHIPPING_UNAVAILABLE')
  return dispatchPostNord(
    config,
    parcel,
    reference,
    messageId,
    transport,
    service,
  )
}

async function dispatchPostNord(
  config: PostNordConfiguration,
  parcel: CentralParcel,
  reference: string,
  messageId: string,
  transport: typeof fetch,
  service: '11' | '24',
) {
  const host =
    config.environment === 'sandbox'
      ? 'https://atapi2.postnord.com'
      : 'https://api2.postnord.com'
  const url = new URL(
    service === '11'
      ? '/rest/shipment/v3/edi'
      : '/rest/shipment/v3/returns/edi',
    host,
  )
  url.search = new URLSearchParams({
    apikey: config.apiKey,
    generateQrcodeImage: 'true',
    qrCodeScale: '4',
    qrCodeFormat: 'PNG',
    ...(service === '24'
      ? {
          functionality: 'STANDARD',
          definePrintout: 'onlyQRCode',
          emailQRcode: 'false',
          smsQRcode: 'false',
        }
      : {}),
    locale: 'sv',
  }).toString()
  const body = postNordReturnBody(config, parcel, reference, messageId)
  body.shipment[0].service.basicServiceCode = service
  if (service === '11') {
    // The owner's approved estimate includes a 1 kg allowance. It is retained
    // separately from any legacy measured weight and never supplied by the app.
    const grams = parcel.weightG ?? parcel.estimatedWeightG
    if (!grams || !Number.isInteger(grams) || grams < 1 || grams > 3000)
      throw new Error('SHIPPING_UNAVAILABLE')
    body.shipment[0].totalGrossWeight = { value: grams / 1000, unit: 'KGM' }
    body.shipment[0].goodsItem[0].items[0].grossWeight = {
      value: grams / 1000,
      unit: 'KGM',
    }
  }
  // Never retry this POST, follow redirects, log the URL/key or expose provider errors.
  const response = await transport(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok || !response.body) throw new Error('BOOKING_UNCONFIRMED')
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 262144) {
        await reader.cancel()
        throw new Error('BOOKING_UNCONFIRMED')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return service === '11'
    ? parsePostNordHomeSmallBooking(value, reference, config.environment)
    : parsePostNordBooking(value, reference)
}

const homeReply = z.object({
  bookingId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  idInformation: z
    .array(
      z.object({
        status: z.literal('OK'),
        references: z.object({
          shipment: z
            .array(
              z.object({ referenceType: z.string(), referenceNo: z.string() }),
            )
            .max(20),
          item: z
            .array(
              z.object({ referenceType: z.string(), referenceNo: z.string() }),
            )
            .max(20),
        }),
        ids: z
          .array(z.object({ idType: z.string(), value: z.string() }))
          .length(1),
        urls: z.array(z.object({ type: z.string(), url: z.string() })).max(10),
      }),
    )
    .length(1),
})

/** Ordinary EDI has no returnId. ALQ is the carrier's Print Label code.
 * Retain the legacy wire field so installed apps can display Home Small codes too.
 * Generate the QR from the validated carrier code, never an internal reference;
 * this exact payload was checked against the carrier's own Sandbox QR.
 */
export async function parsePostNordHomeSmallBooking(
  value: unknown,
  reference: string,
  environment: PostNordConfiguration['environment'],
): Promise<ParcelBooking> {
  const reply = homeReply.parse(value)
  const info = reply.idInformation[0]
  const codes = info.references.item.filter((r) => r.referenceType === 'ALQ')
  const refs = info.references.shipment.filter((r) => r.referenceType === 'CU')
  const urls = info.urls.filter((u) => u.type === 'QRCODE')
  const code = codes[0]?.referenceNo
  const host =
    environment === 'sandbox'
      ? 'https://atapi2.postnord.com'
      : 'https://api2.postnord.com'
  if (
    codes.length !== 1 ||
    !/^[A-Z0-9]{1,128}$/.test(code ?? '') ||
    refs.length !== 1 ||
    refs[0].referenceNo !== reference ||
    info.ids[0].idType !== 'itemId' ||
    urls.length !== 1 ||
    urls[0].url !== `${host}/booking/${code}`
  )
    throw new Error('INVALID_PROVIDER_RESPONSE')
  // No requests to provider-supplied URLs, and no second booking after a bad reply.
  const png = await sharp(
    Buffer.from(
      toSVG({
        bcid: 'qrcode',
        text: code,
        scale: 4,
        padding: 8,
        backgroundcolor: 'FFFFFF',
      }),
    ),
  )
    .png()
    .toBuffer()
  return parcelBooking.parse({
    bookingId: reply.bookingId,
    returnId: code,
    trackingId: info.ids[0].value,
    qrPng: `data:image/png;base64,${png.toString('base64')}`,
  })
}

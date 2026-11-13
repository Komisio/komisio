import { z } from 'zod'
import sharp from 'sharp'
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
          // The person sends the return; Komisio's contracted customer number pays.
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
  const host =
    config.environment === 'sandbox'
      ? 'https://atapi2.postnord.com'
      : 'https://api2.postnord.com'
  const url = new URL('/rest/shipment/v3/returns/edi', host)
  url.search = new URLSearchParams({
    apikey: config.apiKey,
    generateQrcodeImage: 'true',
    qrCodeScale: '4',
    qrCodeFormat: 'PNG',
    functionality: 'STANDARD',
    definePrintout: 'onlyQRCode',
    emailQRcode: 'false',
    smsQRcode: 'false',
    locale: 'sv',
  }).toString()
  // Never retry this POST, follow redirects, log the URL/key or expose provider errors.
  const response = await transport(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(
      postNordReturnBody(config, parcel, reference, messageId),
    ),
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
  return parsePostNordBooking(
    JSON.parse(Buffer.concat(chunks).toString('utf8')),
    reference,
  )
}

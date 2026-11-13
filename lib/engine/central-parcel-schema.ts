import { z } from 'zod'

export const parcelAddress = z.strictObject({
  street: z.string().trim().min(1).max(50),
  postalCode: z.string().regex(/^[1-9][0-9]{4}$/),
  city: z.string().trim().min(1).max(35),
})
export const parcelContact = parcelAddress.extend({
  name: z.string().trim().min(1).max(60),
  email: z.email().max(70),
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  country: z.literal('SE'),
})
export const parcelBooking = z.strictObject({
  bookingId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  returnId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  trackingId: z.string().regex(/^[A-Za-z0-9]{1,35}$/),
  qrPng: z
    .string()
    .max(98304)
    .regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]*$/),
})
export const centralParcel = z
  .object({
    id: z.uuid(),
    reference: z.string().regex(/^P-[1-9][0-9]{0,11}$/),
    environment: z.enum(['sandbox', 'production']),
    sender: parcelContact,
    recipient: parcelContact,
    weightG: z.number().int().min(1).max(20000).nullable(),
    lengthMm: z.number().int().min(1).max(1500).nullable(),
    widthMm: z.number().int().min(1).max(1500).nullable(),
    heightMm: z.number().int().min(1).max(1500).nullable(),
    status: z.enum(['pending', 'needs_review', 'booked']),
    booking: parcelBooking.nullable(),
    createdAt: z.string(),
  })
  .refine((p) => (p.status === 'booked') === (p.booking !== null))
  .refine((p) => validParcelMeasurements(p))
export const bookCentralParcel = z
  .strictObject({
    action: z.literal('book'),
    requestId: z.uuid(),
    offerId: z.uuid(),
    address: parcelAddress,
    weightG: z.number().int().min(1).max(20000).optional(),
    lengthMm: z.number().int().min(1).max(1500).optional(),
    widthMm: z.number().int().min(1).max(1500).optional(),
    heightMm: z.number().int().min(1).max(1500).optional(),
  })
  .refine((p) => validParcelMeasurements(p))
function validParcelMeasurements(p: {
  weightG?: number | null
  lengthMm?: number | null
  widthMm?: number | null
  heightMm?: number | null
}) {
  const values = [p.weightG, p.lengthMm, p.widthMm, p.heightMm]
  return (
    values.every((v) => v == null) ||
    (p.weightG != null &&
      p.lengthMm != null &&
      p.widthMm != null &&
      p.heightMm != null &&
      p.lengthMm >= p.widthMm &&
      p.widthMm >= p.heightMm &&
      p.lengthMm + 2 * (p.widthMm + p.heightMm) <= 3000)
  )
}
export const centralParcelCommand = z.union([
  z.strictObject({ action: z.literal('read'), offerId: z.uuid() }),
  bookCentralParcel,
])
export type CentralParcel = z.infer<typeof centralParcel>
export type ParcelBooking = z.infer<typeof parcelBooking>

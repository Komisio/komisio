import { z } from 'zod'

export const registrationPreferences = z.strictObject({
  descriptionRequired: z.boolean(),
  titleTemplate: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .refine(
      (s) =>
        !/[{}\x00-\x1f\x7f]/.test(
          s.replace(/\{(type|brand|size|color|condition|material)\}/g, ''),
        ),
    ),
  attributes: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/))
    .max(100)
    .refine(
      (a) =>
        new Set(a).size === a.length &&
        !a.some((s) => ['description', 'category'].includes(s)),
    ),
})
export const defaultRegistration = {
  descriptionRequired: false,
  titleTemplate: '{type} {brand} {size}',
  attributes: ['brand', 'size', 'color', 'condition', 'material'],
}
export const registrationRecord = z.object({
  id: z.uuid().nullable(),
  settings: registrationPreferences,
})
export const internalNote = z.object({
  id: z.uuid().nullable(),
  note: z.string().max(2000),
})
export const registrationCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('settings'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    expectedId: z.uuid().nullable(),
    settings: registrationPreferences,
  }),
  z.strictObject({
    action: z.literal('note'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    expectedId: z.uuid().nullable(),
    kind: z.enum(['item', 'reception', 'purchase']),
    subjectId: z.uuid(),
    note: z.string().trim().max(2000),
  }),
])

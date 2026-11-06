import { z } from 'zod'

export const hideableIntakeFields = [
  'description',
  'internalNote',
  'photo',
  'assortment',
  'itemType',
  'category',
  'brand',
  'size',
  'color',
  'condition',
  'material',
] as const
export type HideableIntakeField = (typeof hideableIntakeFields)[number]

export const registrationTitleTemplate = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (s) =>
      !/[{}\x00-\x1f\x7f]/.test(
        s.replace(/\{(type|brand|size|color|condition|material)\}/g, ''),
      ),
  )

export const registrationPreferences = z
  .strictObject({
    // Absence preserves legacy records and their exact retry payloads.
    hiddenFields: z
      .array(z.enum(hideableIntakeFields))
      .max(hideableIntakeFields.length)
      .refine((fields) => new Set(fields).size === fields.length)
      .optional(),
    descriptionRequired: z.boolean(),
    titleTemplate: registrationTitleTemplate,
    attributes: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/))
      .max(100)
      .refine(
        (a) =>
          new Set(a).size === a.length &&
          !a.some((s) => ['description', 'category'].includes(s)),
      ),
  })
  .refine(
    (settings) =>
      !settings.descriptionRequired ||
      !settings.hiddenFields?.includes('description'),
  )
export type RegistrationPreferences = z.infer<typeof registrationPreferences>
export function intakeFieldVisible(
  settings: RegistrationPreferences | undefined,
  field: HideableIntakeField,
) {
  return (
    (field === 'description' && settings?.descriptionRequired) ||
    !settings?.hiddenFields?.includes(field)
  )
}
export const defaultRegistration: RegistrationPreferences = {
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

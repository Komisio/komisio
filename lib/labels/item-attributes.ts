import { z } from 'zod'
import { dictionary, type Locale } from '../i18n'

export const labelAttribute = z.object({
  slug: z.string(),
  value: z.string(),
  labels: z.record(z.string(), z.string()),
  dataType: z.string(),
  unit: z.string(),
  choices: z.array(
    z.object({ id: z.string(), labels: z.record(z.string(), z.string()) }),
  ),
})

/** Values retain their definition version; labels and choice values follow the print language. */
export function labelAttributeLines(
  attributes: z.infer<typeof labelAttribute>[] = [],
  locale: Locale = 'en',
) {
  return attributes
    .filter((a) => a.value.trim())
    .slice(0, 4)
    .map((a) => {
      const choice = a.choices.find((c) => c.id === a.value)
      let value = choice
        ? (choice.labels[locale] ?? choice.labels.en ?? a.value)
        : a.value
      if (a.dataType === 'boolean' && ['true', 'false'].includes(value)) {
        const d = dictionary(locale)
        value = value === 'true' ? d.labelSheets.yes : d.labelSheets.no
      }
      return `${a.labels[locale] ?? a.labels.en ?? a.slug}: ${value}${a.unit ? ` ${a.unit}` : ''}`
    })
}

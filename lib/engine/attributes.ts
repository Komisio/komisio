import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The store's attribute vocabulary and its item types.
 *
 * Three concepts stay separate because they answer different questions. A
 * category is for navigation and reports, an item type decides which questions
 * a screen asks, and an attribute describes one object. A table lamp and a
 * floor lamp share a category and need different questions, which is why a
 * type only suggests a category rather than replacing it.
 *
 * A slug is what the database stores and never what a person reads: labels
 * carry the translations, and a choice carries stable ids for its values so
 * that fixing the spelling of "colour" is not undone by three spellings of
 * navy.
 */
const slug = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)
// A locale may be missing: the application falls back to English exactly as
// its dictionaries do, so the record is open rather than exhaustive.
const localeKeys = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']
const labels = z
  .record(z.string(), z.string().min(1).max(120))
  .refine((l) => Object.keys(l).every((k) => localeKeys.includes(k)))

export const attributeChoice = z.object({
  id: z.string(),
  labels,
  sort: z.number().int().optional(),
})
export const attributeDefinition = z.object({
  slug,
  version: z.number().int().positive(),
  data_type: z.enum(['text', 'number', 'choice', 'boolean']),
  unit: z.string(),
  choices: z.array(attributeChoice),
  labels,
  help: labels,
  active: z.boolean(),
  /** True when the store defined it, false when it comes from the platform. */
  own: z.boolean(),
})
export const itemTypeProfile = z.object({
  slug,
  labels,
  suggested_category: z.string(),
  active: z.boolean(),
  own: z.boolean(),
  attributes: z.array(
    z.object({
      slug,
      expected: z.boolean(),
      sort: z.number().int(),
    }),
  ),
})
export const attributeVocabulary = z.object({
  definitions: z.array(attributeDefinition),
  types: z.array(itemTypeProfile),
})
export type AttributeDefinition = z.infer<typeof attributeDefinition>
export type ItemTypeProfile = z.infer<typeof itemTypeProfile>
export type AttributeVocabulary = z.infer<typeof attributeVocabulary>

/** Read with the caller's client; the function checks the store role. */
export async function readAttributeVocabulary(
  client: SupabaseClient,
  tenantId: string,
): Promise<AttributeVocabulary> {
  const { data, error } = await client.rpc('attribute_vocabulary', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (error) throw new Error('Unable to read the attribute vocabulary')
  return attributeVocabulary.parse(data)
}

/**
 * What a screen should ask for a given type, in the profile's order, with each
 * attribute's definition attached. An attribute a profile names but nothing
 * defines is left out rather than rendered as an input nobody can fill: the
 * profile is guidance, and guidance that points at nothing is not an error.
 */
export function questionsFor(
  vocabulary: AttributeVocabulary,
  typeSlug: string | null,
): { definition: AttributeDefinition; expected: boolean }[] {
  const byslug = new Map(vocabulary.definitions.map((d) => [d.slug, d]))
  const type = vocabulary.types.find((t) => t.slug === typeSlug)
  if (!type) {
    // No type chosen: ask for the description alone, which every item needs.
    const description = byslug.get('description')
    return description ? [{ definition: description, expected: true }] : []
  }
  return type.attributes.flatMap((entry) => {
    const definition = byslug.get(entry.slug)
    return definition && definition.active
      ? [{ definition, expected: entry.expected }]
      : []
  })
}

/** The label a person reads, in their language, falling back to English and
 * then to the slug rather than showing an empty heading. */
export function labelOf(
  item: { slug: string; labels: Record<string, string | undefined> },
  locale: string,
): string {
  return item.labels[locale] ?? item.labels.en ?? item.slug
}

import { questionsFor, type AttributeVocabulary } from '../engine/attributes'
import {
  hideableIntakeFields,
  intakeFieldVisible,
  type HideableIntakeField,
} from '../engine/registration'

export function intakeVisibility(
  vocabulary: AttributeVocabulary,
  itemType: string | null,
) {
  const settings = vocabulary.registration?.settings
  const profile = intakeFieldVisible(settings, 'itemType')
    ? vocabulary.types.find((type) => type.slug === itemType)
    : undefined
  const expected = new Set(
    profile?.inherit_attributes !== true
      ? profile?.attributes
          .filter((field) => field.expected)
          .map((field) => field.slug)
      : [],
  )
  return (field: HideableIntakeField) =>
    expected.has(field) || intakeFieldVisible(settings, field)
}

export function visibleIntakeQuestions(
  vocabulary: AttributeVocabulary,
  itemType: string | null,
) {
  const effectiveType = intakeFieldVisible(
    vocabulary.registration?.settings,
    'itemType',
  )
    ? itemType
    : null
  const visible = intakeVisibility(vocabulary, effectiveType)
  return questionsFor(vocabulary, effectiveType).filter(
    ({ definition, expected }) =>
      expected ||
      !hideableIntakeFields.includes(definition.slug as HideableIntakeField) ||
      visible(definition.slug as HideableIntakeField),
  )
}

/** Only visible answers travel, including answers suggested by the photo assistant. */
export function visibleIntakeFacts(
  facts: Record<string, string>,
  questions: ReturnType<typeof visibleIntakeQuestions>,
) {
  const asked = new Set(questions.map(({ definition }) => definition.slug))
  return Object.fromEntries(
    Object.entries(facts)
      .map(([key, value]) => [key, value.trim()])
      .filter(
        ([key, value]) =>
          asked.has(key) && (value !== '' || key === 'description'),
      ),
  )
}

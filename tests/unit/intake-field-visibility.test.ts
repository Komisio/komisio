import { expect, it } from 'vitest'
import { attributeVocabulary } from '../../lib/engine/attributes'
import {
  defaultRegistration,
  hideableIntakeFields,
  intakeFieldVisible,
  registrationPreferences,
} from '../../lib/engine/registration'
import {
  intakeVisibility,
  visibleIntakeFacts,
  visibleIntakeQuestions,
} from '../../lib/intake/intake-field-visibility'

const vocabulary = attributeVocabulary.parse({
  definitions: ['description', 'brand', 'size', 'color', 'socket'].map(
    (slug) => ({
      slug,
      version: 1,
      data_type: 'text',
      unit: '',
      choices: [],
      labels: { en: slug },
      help: {},
      active: true,
      own: false,
    }),
  ),
  types: [
    {
      slug: 'lamp',
      labels: { en: 'Lamp' },
      suggested_category: '',
      active: true,
      own: true,
      inherit_attributes: false,
      attributes: [
        { slug: 'brand', expected: true, sort: 0 },
        { slug: 'size', expected: false, sort: 1 },
        { slug: 'socket', expected: true, sort: 2 },
      ],
    },
  ],
  registration: { id: null, settings: defaultRegistration },
})
it('legacy and default settings leave every optional field visible', () => {
  for (const field of hideableIntakeFields) {
    expect(intakeFieldVisible(undefined, field)).toBe(true)
    expect(intakeFieldVisible(defaultRegistration, field)).toBe(true)
  }
  expect(registrationPreferences.parse(defaultRegistration)).toEqual(
    defaultRegistration,
  )
})
it('rejects hidden price, unknown fields, duplicates and a hidden required description', () => {
  for (const hiddenFields of [['price'], ['unknown'], ['photo', 'photo'], null])
    expect(
      registrationPreferences.safeParse({
        ...defaultRegistration,
        hiddenFields,
      }).success,
    ).toBe(false)
  expect(
    registrationPreferences.safeParse({
      ...defaultRegistration,
      descriptionRequired: true,
      hiddenFields: ['description'],
    }).success,
  ).toBe(false)
  expect(
    intakeFieldVisible(
      {
        ...defaultRegistration,
        descriptionRequired: true,
        hiddenFields: ['description'],
      },
      'description',
    ),
  ).toBe(true)
})
it('keeps expected type questions visible while hiding optional generic questions', () => {
  const v = {
    ...vocabulary,
    registration: {
      id: null,
      settings: {
        ...defaultRegistration,
        hiddenFields: hideableIntakeFields.filter(
          (field) => field !== 'itemType',
        ),
      },
    },
  }
  expect(
    visibleIntakeQuestions(v, 'lamp').map((q) => q.definition.slug),
  ).toEqual(['brand', 'socket'])
  expect(visibleIntakeQuestions(v, null)).toEqual([])
  expect(
    visibleIntakeQuestions(
      {
        ...v,
        registration: {
          id: null,
          settings: {
            ...v.registration.settings,
            hiddenFields: [...hideableIntakeFields],
          },
        },
      },
      'lamp',
    ),
  ).toEqual([])
  expect(
    visibleIntakeFacts(
      {
        description: 'AI description',
        brand: ' Brand ',
        size: 'M',
        color: 'blue',
        socket: 'E27',
        unknown: 'drop',
      },
      visibleIntakeQuestions(v, 'lamp'),
    ),
  ).toEqual({ brand: 'Brand', socket: 'E27' })
})
it('submits only visible answers and does not carry stale answers from a previous type', () => {
  const questions = visibleIntakeQuestions(vocabulary, 'lamp')
  expect(
    visibleIntakeFacts(
      {
        description: '',
        brand: 'Brand',
        size: ' ',
        color: 'old',
        socket: 'E27',
      },
      questions,
    ),
  ).toEqual({ description: '', brand: 'Brand', socket: 'E27' })
})
it('keeps expected type description and category visible despite generic hiding', () => {
  const v = {
    ...vocabulary,
    types: [
      {
        ...vocabulary.types[0],
        attributes: [
          { slug: 'description', expected: true, sort: 0 },
          { slug: 'category', expected: true, sort: 1 },
        ],
      },
    ],
    registration: {
      id: null,
      settings: {
        ...defaultRegistration,
        hiddenFields: hideableIntakeFields.filter(
          (field) => field !== 'itemType',
        ),
      },
    },
  }
  expect(intakeVisibility(v, 'lamp')('category')).toBe(true)
  expect(
    visibleIntakeQuestions(v, 'lamp').map((q) => q.definition.slug),
  ).toEqual(['description'])
  expect(visibleIntakeQuestions(v, null)).toEqual([])
})

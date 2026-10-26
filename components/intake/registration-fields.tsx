'use client'
import {
  labelOf,
  questionsFor,
  type AttributeVocabulary,
} from '@/lib/engine/attributes'
export function RegistrationFields({
  vocabulary,
  itemType,
  locale,
  initial = {},
}: {
  vocabulary: AttributeVocabulary
  itemType: string | null
  locale: string
  initial?: Record<string, string>
}) {
  return (
    <>
      {questionsFor(vocabulary, itemType)
        .filter((q) => q.definition.slug !== 'description')
        .map(({ definition: a }) => (
          <div className="field" key={a.slug}>
            <label htmlFor={`registration-${a.slug}`}>
              {labelOf(a, locale)}
              {a.unit ? ` (${a.unit})` : ''}
            </label>
            {a.data_type === 'choice' ? (
              <select
                id={`registration-${a.slug}`}
                name={`attribute-${a.slug}`}
                defaultValue={initial[a.slug] ?? ''}
              >
                <option value="">—</option>
                {a.choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {labelOf({ slug: c.id, labels: c.labels }, locale)}
                  </option>
                ))}
              </select>
            ) : a.data_type === 'boolean' ? (
              <input
                id={`registration-${a.slug}`}
                name={`attribute-${a.slug}`}
                type="checkbox"
                value="true"
                defaultChecked={initial[a.slug] === 'true'}
              />
            ) : (
              <input
                id={`registration-${a.slug}`}
                name={`attribute-${a.slug}`}
                defaultValue={initial[a.slug] ?? ''}
                maxLength={1000}
                inputMode={a.data_type === 'number' ? 'decimal' : 'text'}
              />
            )}
          </div>
        ))}
    </>
  )
}

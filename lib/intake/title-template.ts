// UI editing only. PostgreSQL remains authoritative for actual item names.
export const titleFields = [
  'type',
  'brand',
  'size',
  'color',
  'condition',
  'material',
] as const
export type TitleField = (typeof titleFields)[number]
type Template = { fields: TitleField[]; text: string[] }

export function parseTitleTemplate(value: string): Template {
  const fields: TitleField[] = []
  const text: string[] = []
  let end = 0
  for (const match of value.matchAll(
    /\{(type|brand|size|color|condition|material)\}/g,
  )) {
    text.push(value.slice(end, match.index))
    fields.push(match[1] as TitleField)
    end = match.index + match[0].length
  }
  text.push(value.slice(end))
  return { fields, text }
}

export function serializeTitleTemplate(template: Template) {
  return template.fields.reduce(
    (value, field, index) => value + `{${field}}` + template.text[index + 1],
    template.text[0],
  )
}

export function addTitleField(value: string, field: TitleField) {
  if (parseTitleTemplate(value).fields.includes(field)) return value
  return value + (value && !/\s$/.test(value) ? ' ' : '') + `{${field}}`
}

export function moveTitleField(
  value: string,
  index: number,
  direction: -1 | 1,
) {
  const template = parseTitleTemplate(value)
  const target = index + direction
  if (!template.fields[index] || !template.fields[target]) return value
  ;[template.fields[index], template.fields[target]] = [
    template.fields[target],
    template.fields[index],
  ]
  return serializeTitleTemplate(template)
}

export function removeTitleField(value: string, index: number) {
  const template = parseTitleTemplate(value)
  if (!template.fields[index]) return value
  const joined = template.text[index] + template.text[index + 1]
  // Preserve custom punctuation/text. Only redundant inter-field whitespace
  // is removed with a field; untouched templates are never normalized.
  const gap = joined.trim()
    ? joined
    : index > 0 && index < template.fields.length - 1
      ? ' '
      : ''
  template.text.splice(index, 2, gap)
  template.fields.splice(index, 1)
  return serializeTitleTemplate(template)
}

export function previewTitleTemplate(
  value: string,
  examples: Partial<Record<TitleField, string>>,
) {
  return (
    value
      .replace(
        /\{(type|brand|size|color|condition|material)\}/g,
        (_, field: TitleField) => examples[field] ?? '',
      )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000) || 'I-1234ABCD'
  )
}

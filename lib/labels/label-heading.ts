/** Punctuation placeholders are not product descriptions. Keep real text verbatim. */
export function labelHeading(value: string | null | undefined): string {
  const text = value?.trim() ?? ''
  return /[\p{L}\p{N}]/u.test(text) ? text : ''
}

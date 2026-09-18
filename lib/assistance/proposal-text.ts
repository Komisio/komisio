/** Sentence casing for generated prose; preserve the rest of the spelling. */
export function initialCapital(value: string) {
  return value.trim().replace(/^\p{Ll}/u, (letter) => letter.toUpperCase())
}

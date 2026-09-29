import type { ItemActor } from '@/lib/engine/items'

export function ActorSignature({
  actor,
  unknown,
}: {
  actor: ItemActor | undefined
  unknown: string
}) {
  if (!actor) return null
  const words = actor.name?.trim().split(/\s+/).filter(Boolean) ?? []
  const initials = words.length
    ? [words[0], ...(words.length > 1 ? [words.at(-1)!] : [])]
        .map((word) => Array.from(word)[0])
        .join('')
        .toLocaleUpperCase()
    : '?'
  return (
    <details className="actor-signature">
      <summary aria-label={actor.name || unknown}>{initials}</summary>
      <span className="actor-signature-name">{actor.name || unknown}</span>
    </details>
  )
}

export function directoryOrder<T extends string>(
  keys: readonly T[],
  value: unknown,
) {
  const [key, direction, extra] =
    typeof value === 'string' ? value.split(':') : []
  const valid =
    keys.includes(key as T) &&
    (direction === 'asc' || direction === 'desc') &&
    extra === undefined
  return {
    sort: valid ? (key as T) : keys[0],
    direction: valid ? (direction as 'asc' | 'desc') : ('asc' as const),
    value: valid ? `${key}:${direction}` : `${keys[0]}:asc`,
  }
}

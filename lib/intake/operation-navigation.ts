import { operationPageInput } from '../engine/operation-page'

export function operationQueueHref(input: unknown = {}) {
  const c = operationPageInput.parse(input),
    params = new URLSearchParams({ status: c.status })
  if (c.beforeCreated && c.beforeId) {
    params.set('beforeCreated', c.beforeCreated)
    params.set('beforeId', c.beforeId)
  }
  return `/intake/operations?${params.toString()}`
}

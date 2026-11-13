import {
  externalRequestStatuses,
  type ExternalRequestStatus,
  type ExternalRequestFilters,
} from '@/lib/engine/external-item-offers'
export type { ExternalRequestFilters } from '@/lib/engine/external-item-offers'

export function externalRequestFilters(params: {
  status?: unknown
  q?: unknown
}): ExternalRequestFilters {
  return {
    status: externalRequestStatuses.includes(
      params.status as ExternalRequestStatus,
    )
      ? (params.status as ExternalRequestStatus)
      : 'all',
    query: typeof params.q === 'string' ? params.q.trim().slice(0, 120) : '',
  }
}

export function externalRequestHref(filters: ExternalRequestFilters, page = 1) {
  const params = new URLSearchParams()
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.query) params.set('q', filters.query)
  if (page > 1) params.set('page', String(page))
  return `/intake/requests${params.size ? `?${params}` : ''}`
}

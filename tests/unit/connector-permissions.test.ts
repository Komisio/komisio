import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { connectorScopes } from '../../lib/engine/connectors'
import { summarizeConnectorPermissions } from '../../lib/platform/connector-permissions'
import { ConnectorsPanel } from '../../components/platform/connectors-panel'
import { dictionary } from '../../lib/i18n'

it('accounts for every supported permission without conflating read, preview and propose', () => {
  const result = summarizeConnectorPermissions([...connectorScopes])
  expect(result.counts).toEqual({ read: 6, preview: 1, propose: 9, other: 0 })
  expect(result.groups.flatMap((g) => g.scopes).sort()).toEqual(
    [...connectorScopes].sort(),
  )
  expect(result.groups).toHaveLength(10)
})
it('retains unknown permissions without implying known access and counts duplicate grants once', () => {
  const result = summarizeConnectorPermissions([
    'items:read',
    'items:read',
    'custom:read',
    'toString',
  ])
  expect(result.counts).toEqual({ read: 1, preview: 0, propose: 0, other: 2 })
  expect(result.groups).toEqual([
    { area: 'items', scopes: ['items:read'] },
    { area: 'other', scopes: ['custom:read', 'toString'] },
  ])
  expect(summarizeConnectorPermissions([]).groups).toEqual([])
})

it('renders unknown permission names as escaped text rather than object properties', () => {
  const markup = renderToStaticMarkup(
    createElement(ConnectorsPanel, {
      tenantId: '10000000-0000-4000-8000-000000000001',
      endpoint: 'https://example.test/api/mcp',
      locale: 'en',
      d: dictionary('en').connectors,
      connectors: [
        {
          id: '10000000-0000-4000-8000-000000000002',
          tenantId: '10000000-0000-4000-8000-000000000001',
          clientId: '10000000-0000-4000-8000-000000000003',
          userId: '10000000-0000-4000-8000-000000000004',
          clientName: 'Synthetic assistant',
          userName: null,
          scopes: ['toString', '<script>alert(1)</script>'],
          createdAt: '2026-10-16T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
          calls: 0,
        },
      ],
    }),
  )
  expect(markup).toContain('toString')
  expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(markup).not.toContain('<script>')
})

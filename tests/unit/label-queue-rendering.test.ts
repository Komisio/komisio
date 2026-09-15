import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { queueRenderedLabel } from '../../lib/engine/printing'

const tenantId = '10000000-0000-4000-8000-000000000001'
const referenceId = '20000000-0000-4000-8000-000000000002'
const printerId = '30000000-0000-4000-8000-000000000003'
const requestId = '40000000-0000-4000-8000-000000000004'
function fixture(
  options: { custom?: boolean; missing?: string; queueError?: string } = {},
) {
  const filters: unknown[][] = []
  const rows: Record<string, unknown> = {
    bag_receipts: { reference: 12, received_at: '2026-09-15T10:00:00Z' },
    garment_receipts: { reference: 34, received_at: '2026-09-15T10:00:00Z' },
    items: {
      id: referenceId,
      origin_kind: 'garment_receipt',
      terms: { origin: { garmentReference: 34 } },
    },
    item_prices: [{ price_ore: 10000 }, { price_ore: 20000 }],
    sellers: { id: referenceId, name: 'Synthetic ^JUS~JA seller' },
    printers: { dpi: 300 },
  }
  const from = vi.fn((table: string) => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        filters.push([table, key, value])
        return query
      },
      order: () => query,
      limit: async () => ({ data: rows[table], error: null }),
      maybeSingle: async () => ({
        data: options.missing === table ? null : rows[table],
        error: null,
      }),
    }
    return query
  })
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'store_currency') return { data: 'SEK', error: null }
    if (name === 'label_formats')
      return {
        data: Object.fromEntries(
          ['bag', 'garment', 'item', 'onboarding', 'markdown'].map((kind) => [
            kind,
            { widthMm: 76, heightMm: 51, custom: true },
          ]),
        ),
        error: null,
      }
    if (name === 'label_templates')
      return {
        data: options.custom
          ? {
              bag: {
                id: referenceId,
                version: 7,
                name: 'Synthetic',
                createdAt: '2026-09-15T10:00:00Z',
                zpl: '^XA^PW{width}^LL{height}^FO10,10^FD{store} {reference}^FS^XZ',
              },
            }
          : {},
        error: null,
      }
    return {
      data: args.p_id,
      error: options.queueError ? { message: options.queueError } : null,
    }
  })
  return { client: { from, rpc } as unknown as SupabaseClient, rpc, filters }
}
describe('shared label render and queue path', () => {
  it.each([
    ['bag', 'bag_receipt', 'K-12'],
    ['garment', 'garment_receipt', 'G-34'],
    ['item', 'item', 'I-20000000'],
    ['markdown', 'item', 'I-20000000'],
    ['onboarding', 'seller', 'S-20000000'],
  ] as const)(
    'renders %s from tenant-bound facts and retains the queue identity',
    async (kind, referenceKind, reference) => {
      const setup = fixture()
      const input = {
        tenantId,
        referenceId,
        printerId,
        requestId,
        kind,
        referenceKind,
        copies: 2,
      }
      await expect(
        queueRenderedLabel(
          setup.client,
          input,
          'Synthetic ^JUS~JA Store',
          'https://example.test',
        ),
      ).resolves.toEqual({ ok: true, id: requestId })
      expect(setup.rpc).toHaveBeenLastCalledWith(
        'queue_print_job',
        expect.objectContaining({
          p_tenant: tenantId,
          p_id: requestId,
          p_printer: printerId,
          p_kind: kind,
          p_reference_kind: referenceKind,
          p_reference_id: referenceId,
          p_copies: 2,
          p_template_version: 'zpl-v2',
          p_payload: expect.stringContaining(reference),
        }),
      )
      const payload = setup.rpc.mock.calls.at(-1)![1].p_payload as string
      expect(payload).not.toContain('^JUS')
      expect(payload).not.toContain('~')
      if (kind === 'markdown') {
        expect(payload).toContain('100.00')
        expect(payload).toContain('200.00')
      }
      for (const table of new Set(setup.filters.map(([table]) => table)))
        expect(setup.filters).toContainEqual([table, 'tenant_id', tenantId])
    },
  )
  it('uses the saved template version and the kind size at printer DPI', async () => {
    const setup = fixture({ custom: true })
    await queueRenderedLabel(
      setup.client,
      {
        tenantId,
        referenceId,
        printerId,
        requestId,
        kind: 'bag',
        referenceKind: 'bag_receipt',
      },
      'Synthetic',
      'https://example.test',
    )
    expect(setup.rpc).toHaveBeenLastCalledWith(
      'queue_print_job',
      expect.objectContaining({
        p_template_version: 'store-v7',
        p_payload: expect.stringContaining('^PW898^LL602'),
      }),
    )
  })
  it.each(['bag_receipts', 'printers'])(
    'does not queue when %s is missing',
    async (missing) => {
      const setup = fixture({ missing })
      await expect(
        queueRenderedLabel(
          setup.client,
          {
            tenantId,
            referenceId,
            printerId,
            requestId,
            kind: 'bag',
            referenceKind: 'bag_receipt',
          },
          'Synthetic',
          'https://example.test',
        ),
      ).rejects.toThrow(
        missing === 'printers' ? 'PRINTER_NOT_FOUND' : 'REFERENCE_NOT_FOUND',
      )
      expect(
        setup.rpc.mock.calls.some(([name]) => name === 'queue_print_job'),
      ).toBe(false)
    },
  )
  it('preserves database refusal without exposing arbitrary error details', async () => {
    const setup = fixture({
      queueError: 'REQUEST_CONFLICT private database detail',
    })
    await expect(
      queueRenderedLabel(
        setup.client,
        {
          tenantId,
          referenceId,
          printerId,
          requestId,
          kind: 'bag',
          referenceKind: 'bag_receipt',
        },
        'Synthetic',
        'https://example.test',
      ),
    ).rejects.toThrow(/^REQUEST_CONFLICT$/)
  })
})

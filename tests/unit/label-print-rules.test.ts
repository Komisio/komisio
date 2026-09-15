import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readLabelPrintRules,
  setLabelPrintRule,
} from '../../lib/engine/printing'

const tenantId = '10000000-0000-4000-8000-000000000001'
const rule = {
  kind: 'item' as const,
  printerId: '20000000-0000-4000-8000-000000000002',
  copies: 2,
  enabled: true,
}
it('uses the rule engine command without queueing a print job', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: rule, error: null })
  expect(
    await setLabelPrintRule({ rpc } as unknown as SupabaseClient, {
      ...rule,
      tenantId,
    }),
  ).toEqual(rule)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('set_label_print_rule', {
    p_tenant: tenantId,
    p_kind: 'item',
    p_printer: rule.printerId,
    p_copies: 2,
    p_enabled: true,
  })
})
it('rejects invalid copy counts before calling the database', async () => {
  const rpc = vi.fn()
  await expect(
    setLabelPrintRule({ rpc } as unknown as SupabaseClient, {
      ...rule,
      tenantId,
      copies: 21,
    }),
  ).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
})
it('tolerates only a missing rule read during deployment', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ error: { code: '42501' } })
    .mockResolvedValueOnce({ data: [rule], error: null })
  const client = { rpc } as unknown as SupabaseClient
  expect(await readLabelPrintRules(client, tenantId)).toBeNull()
  await expect(readLabelPrintRules(client, tenantId)).rejects.toThrow(
    'FORBIDDEN',
  )
  expect(await readLabelPrintRules(client, tenantId)).toEqual([rule])
})

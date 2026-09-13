import { beforeEach, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  config: vi.fn(),
  reserve: vi.fn(),
  adapter: vi.fn(),
  photo: vi.fn(),
  image: vi.fn(),
}))
vi.mock('../../lib/engine/reception-store', () => ({
  readReceptionSession: mocks.read,
}))
vi.mock('../../lib/assistance/reception-config', () => ({
  receptionAIConfig: mocks.config,
  resolveReceptionAssistance: mocks.config,
}))
vi.mock('../../lib/engine/reception-assistance', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reserveReceptionAssistance: mocks.reserve,
}))
vi.mock('../../lib/assistance/openai-reception', () => ({
  openAIReception: mocks.adapter,
  receptionPromptVersion: 'reception-v1',
  batchPromptVersion: 'reception-batch-v1',
}))
vi.mock('../../lib/engine/reception-photos', () => ({
  readReceptionPhoto: mocks.photo,
}))
vi.mock('../../lib/assistance/reception-image', () => ({
  receptionImage: mocks.image,
}))
import { runReceptionAssistance } from '../../lib/assistance/run-reception'
const id = (n: number) =>
  `84000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const command = {
  tenantId: id(1),
  sessionId: id(2),
  requestId: id(9),
  revision: 1,
}
const session = {
  schemaVersion: 1,
  tenantId: id(1),
  sessionId: id(2),
  sellerId: id(3),
  revision: 1,
  sources: [
    {
      id: id(4),
      kind: 'observation',
      reference: 'fixture',
      observation: 'Jacket',
    },
  ],
}
const proposed = {
  metadata: {
    description: {
      value: 'Jacket',
      sourceIds: [id(4)],
      certainty: 'tentative',
    },
  },
  price: null,
  questions: ['Price evidence?'],
}
const rpc = vi.fn(),
  client = { rpc } as unknown as SupabaseClient
const run = () =>
  runReceptionAssistance(client, command, new AbortController().signal)
beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockResolvedValue({ data: 'staff', error: null })
  mocks.read.mockReset().mockResolvedValue({ status: 'ready', session })
  mocks.config.mockReturnValue({ key: 'fixture', model: 'fixture' })
  mocks.reserve.mockReset().mockResolvedValue(true)
  mocks.adapter.mockReturnValue({ suggest: async () => proposed })
})
it('unconfigured assistance returns unavailable without reserving or invoking', async () => {
  mocks.config.mockReturnValue(null)
  expect(await run()).toEqual({ status: 'unavailable', proposal: null })
  expect(mocks.reserve).not.toHaveBeenCalled()
  expect(mocks.adapter).not.toHaveBeenCalled()
})
it('readonly cannot invoke even when configured', async () => {
  rpc.mockResolvedValue({ data: 'readonly' })
  await expect(run()).rejects.toThrow('FORBIDDEN')
  expect(mocks.reserve).not.toHaveBeenCalled()
})
it('a repeated reservation never starts another call', async () => {
  mocks.reserve.mockResolvedValue(false)
  await expect(run()).rejects.toThrow('ASSISTANCE_ALREADY_ATTEMPTED')
  expect(mocks.adapter).not.toHaveBeenCalled()
})
it('does not return output when sources change during inference', async () => {
  mocks.read
    .mockResolvedValueOnce({ status: 'ready', session })
    .mockResolvedValueOnce({
      status: 'ready',
      session: { ...session, revision: 2 },
    })
  await expect(run()).rejects.toThrow('RECEPTION_CHANGED')
})
it('rechecks staff authority after inference', async () => {
  rpc
    .mockResolvedValueOnce({ data: 'staff' })
    .mockResolvedValueOnce({ data: 'readonly' })
  await expect(run()).rejects.toThrow('FORBIDDEN')
})
it('returns only a current transient proposal, never a seller review write', async () => {
  const result = await run()
  expect(result.status).toBe('proposed')
  if (!('proposal' in result)) throw new Error('Expected single proposal')
  expect(result.proposal?.baseRevision).toBe(1)
  expect(result.proposal?.sellerId).toBe(id(3))
  expect(mocks.reserve).toHaveBeenCalledOnce()
})

import { beforeEach, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import fixture from '../fixtures/reception-batch.json'
const m = vi.hoisted(() => ({
  read: vi.fn(),
  photo: vi.fn(),
  upload: vi.fn(),
  write: vi.fn(),
  propose: vi.fn(),
}))
vi.mock('../../lib/engine/reception-store', () => ({
  readReceptionSession: m.read,
}))
vi.mock('../../lib/engine/reception-photos', () => ({
  readReceptionPhoto: m.photo,
  uploadReceptionPhoto: m.upload,
}))
vi.mock('../../lib/engine/intake', () => ({ executeIntake: m.write }))
vi.mock('../../lib/engine/operations', () => ({ proposeOperation: m.propose }))
import {
  batchRowIds,
  stageReceptionBatchRow,
} from '../../lib/engine/reception-batch'
const command = () => ({
  tenantId: fixture.session.tenantId,
  sessionId: fixture.session.sessionId,
  batchId: fixture.batchId,
  revision: 1,
  row: 0,
  candidate: structuredClone(fixture.split.candidates[0]),
  reviewedFields: ['description', 'price'],
  confirmed: true,
  agreementId: null,
  expiresAt: '2099-01-01T00:00:00.000Z',
})
const rpc = vi.fn(),
  query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() },
  client = { rpc, from: () => query } as unknown as SupabaseClient
beforeEach(() => {
  vi.resetAllMocks()
  rpc.mockResolvedValue({ data: 'staff', error: null })
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.maybeSingle.mockResolvedValue({
    data: {
      session_id: fixture.session.sessionId,
      source_revision: 1,
      prompt_version: 'reception-batch-v1',
    },
    error: null,
  })
  m.read.mockResolvedValue({ status: 'ready', session: fixture.session })
  m.photo.mockResolvedValue({ bytes: new Uint8Array([1]) })
  m.upload.mockImplementation(async (_client, c) => ({
    id: c.photoId,
    kind: 'photo',
    reference: `${c.tenantId}/${c.sessionId}/${c.photoId}.jpg`,
    observation: '',
  }))
  m.write.mockResolvedValue({ data: 'id', error: null })
  m.propose.mockResolvedValue({ data: 'id', error: null })
})
it('copies under child storage boundaries and stages only the existing operation', async () => {
  const c = command(),
    result = await stageReceptionBatchRow(client, c)
  expect(result).toMatchObject({
    sessionId: batchRowIds(c).sessionId,
    operationId: batchRowIds(c).operationId,
  })
  const saved = m.write.mock.calls[1][1]
  expect(saved.sources[0].reference).toContain(result.sessionId)
  expect(saved.sources[0].reference).not.toContain(c.sessionId)
  expect(m.propose.mock.calls[0][1]).toMatchObject({
    kind: 'publishReceptionReview',
    payload: {
      sourceRevision: 1,
      sessionId: result.sessionId,
      suggestions: { metadata: { description: { certainty: 'observed' } } },
    },
  })
  expect(m.write.mock.calls.map((call) => call[1].action)).toEqual([
    'createReception',
    'saveReceptionSources',
  ])
})
it('accepts any batch prompt version and still refuses a single-item attempt', async () => {
  // Versioning the batch prompt used to turn every batch into
  // BATCH_ATTEMPT_REQUIRED, because the check named one version instead of
  // asking whether the attempt was a batch at all.
  query.maybeSingle.mockResolvedValue({
    data: {
      session_id: fixture.session.sessionId,
      source_revision: 1,
      prompt_version: 'reception-batch-v2',
    },
    error: null,
  })
  await expect(stageReceptionBatchRow(client, command())).resolves.toBeTruthy()
  query.maybeSingle.mockResolvedValue({
    data: {
      session_id: fixture.session.sessionId,
      source_revision: 1,
      prompt_version: 'reception-v2',
    },
    error: null,
  })
  await expect(stageReceptionBatchRow(client, command())).rejects.toThrow(
    'BATCH_ATTEMPT_REQUIRED',
  )
})
it('retains request identity across partial failure and distinguishes rows', async () => {
  const c = command()
  m.photo.mockResolvedValueOnce(null)
  await expect(stageReceptionBatchRow(client, c)).rejects.toThrow(
    'ASSISTANCE_IMAGE_UNAVAILABLE',
  )
  await stageReceptionBatchRow(client, c)
  expect(m.write.mock.calls[0][1].requestId).toBe(
    m.write.mock.calls[1][1].requestId,
  )
  expect(batchRowIds({ ...c, row: 1 }).sessionId).not.toBe(
    batchRowIds(c).sessionId,
  )
  expect(
    batchRowIds({
      ...c,
      candidate: {
        ...c.candidate,
        suggestions: { ...c.candidate.suggestions, questions: ['Changed'] },
      },
    }),
  ).toEqual(batchRowIds(c))
})
it('denies missing review, attempt, readonly and stale evidence before publication', async () => {
  await expect(
    stageReceptionBatchRow(client, {
      ...command(),
      reviewedFields: ['description'],
    }),
  ).rejects.toThrow('RECEPTION_REVIEW_INCOMPLETE')
  expect(m.write).not.toHaveBeenCalled()
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
  await expect(stageReceptionBatchRow(client, command())).rejects.toThrow(
    'BATCH_ATTEMPT_REQUIRED',
  )
  rpc.mockResolvedValueOnce({ data: 'readonly', error: null })
  await expect(stageReceptionBatchRow(client, command())).rejects.toThrow(
    'FORBIDDEN',
  )
  m.read
    .mockResolvedValueOnce({ status: 'ready', session: fixture.session })
    .mockResolvedValueOnce({
      status: 'ready',
      session: { ...fixture.session, revision: 2 },
    })
  await expect(stageReceptionBatchRow(client, command())).rejects.toThrow(
    'RECEPTION_CHANGED',
  )
  expect(m.propose).not.toHaveBeenCalled()
})

import { it, expect, vi } from 'vitest'
import fixture from '../fixtures/reception-batch.json'
import {
  prepareReceptionBatch,
  suggestReceptionBatch,
} from '../../lib/assistance/reception-batch'
import {
  openAIReception,
  batchInstructions,
  batchPromptVersion,
} from '../../lib/assistance/openai-reception'
import { createHash } from 'node:crypto'
const fresh = () => structuredClone(fixture)
it('splits fixture garments with isolated citations and tentative facts', () => {
  const f = fresh(),
    result = prepareReceptionBatch(f.session, f.split, f.batchId)
  expect(result.candidates).toHaveLength(2)
  expect(result.candidates[0].suggestions.metadata.description?.certainty).toBe(
    'tentative',
  )
  expect(f.split.candidates[0].suggestions.metadata.description.certainty).toBe(
    'observed',
  )
  expect(result.sellerId).toBe(f.session.sellerId)
})
it('rejects identities and unknown fields from the model', () => {
  const f = fresh()
  expect(() =>
    prepareReceptionBatch(
      f.session,
      { ...f.split, tenantId: f.session.tenantId },
      f.batchId,
    ),
  ).toThrow()
})
it('rejects cross-row and unknown source citations', () => {
  const f = fresh()
  f.split.candidates[0].suggestions.metadata.description.sourceIds = [
    f.session.sources[1].id,
  ]
  expect(() => prepareReceptionBatch(f.session, f.split, f.batchId)).toThrow(
    'RECEPTION_UNKNOWN_SOURCE',
  )
  f.split.candidates[0].sourceIds.push(f.batchId)
  expect(() => prepareReceptionBatch(f.session, f.split, f.batchId)).toThrow(
    'RECEPTION_UNKNOWN_SOURCE',
  )
})
it('rejects photo-based prices and asks when price evidence is missing', () => {
  const f = fresh()
  f.split.candidates[0].suggestions.price.sourceIds = [f.session.sources[0].id]
  expect(() => prepareReceptionBatch(f.session, f.split, f.batchId)).toThrow(
    'RECEPTION_PRICE_EVIDENCE_REQUIRED',
  )
  const missing = {
    ...f.split.candidates[0],
    suggestions: {
      ...f.split.candidates[0].suggestions,
      price: null,
      questions: [] as string[],
    },
  }
  expect(() =>
    prepareReceptionBatch(
      f.session,
      { candidates: [missing], questions: ['Other photo unclear'] },
      f.batchId,
    ),
  ).toThrow('BATCH_PRICE_QUESTION_REQUIRED')
  missing.suggestions.questions.push('Please supply a price appraisal')
  expect(
    prepareReceptionBatch(
      f.session,
      { candidates: [missing], questions: ['Other photo unclear'] },
      f.batchId,
    ).candidates[0].suggestions.price,
  ).toBeNull()
})
it('rejects duplicate rows, oversized output and silently discarded photos', () => {
  const f = fresh()
  expect(() =>
    prepareReceptionBatch(
      f.session,
      {
        ...f.split,
        candidates: [...f.split.candidates, f.split.candidates[0]],
      },
      f.batchId,
    ),
  ).toThrow('BATCH_DUPLICATE_ROW')
  expect(() =>
    prepareReceptionBatch(
      f.session,
      { ...f.split, candidates: Array(9).fill(f.split.candidates[0]) },
      f.batchId,
    ),
  ).toThrow()
  expect(() =>
    prepareReceptionBatch(
      f.session,
      { ...f.split, candidates: [f.split.candidates[0]] },
      f.batchId,
    ),
  ).toThrow('BATCH_UNASSIGNED_PHOTO')
  expect(() =>
    prepareReceptionBatch(
      f.session,
      { candidates: [], questions: [] },
      f.batchId,
    ),
  ).toThrow('BATCH_EMPTY')
  expect(
    prepareReceptionBatch(
      f.session,
      { candidates: [], questions: ['Please separate the garments'] },
      f.batchId,
    ).candidates,
  ).toEqual([])
})
it('keeps shared overview photos possible when staff review distinct rows', () => {
  const f = fresh()
  f.split.candidates[1].sourceIds.push(f.session.sources[0].id)
  expect(
    prepareReceptionBatch(f.session, f.split, f.batchId).candidates,
  ).toHaveLength(2)
})
it('minimizes provider context and honors cancellation', async () => {
  const f = fresh(),
    suggest = vi.fn(async () => f.split),
    controller = new AbortController()
  await suggestReceptionBatch(
    f.session,
    f.batchId,
    { suggest },
    controller.signal,
  )
  const evidence = JSON.stringify(suggest.mock.calls[0])
  for (const secret of [
    f.session.tenantId,
    f.session.sessionId,
    f.session.sellerId,
    f.session.sources[0].reference,
  ])
    expect(evidence).not.toContain(secret)
  controller.abort()
  await expect(
    suggestReceptionBatch(f.session, f.batchId, { suggest }, controller.signal),
  ).rejects.toThrow()
  expect(suggest).toHaveBeenCalledTimes(1)
})
it('pins the batch prompt independently of the single-garment prompt', () => {
  expect(batchPromptVersion).toBe('reception-batch-v2')
  expect(createHash('sha256').update(batchInstructions).digest('hex')).toBe(
    '6d8239ce51642d0a8e42a263c01621ac2696443ba39d3733d2fbc317e2633968',
  )
})
it('uses the existing provider transport with a bounded batch schema', async () => {
  const f = fresh(),
    wire = {
      ...f.split,
      candidates: f.split.candidates.map((row) => ({
        ...row,
        suggestions: {
          ...row.suggestions,
          metadata: {
            category: null,
            color: null,
            brand: null,
            size: null,
            material: null,
            condition: null,
            ...row.suggestions.metadata,
          },
        },
      })),
    }
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(wire) }],
            },
          ],
        }),
      ),
  )
  const adapter = openAIReception(
    { key: 'fixture-only', model: 'fixture' },
    new Map(
      f.session.sources
        .filter((s) => s.kind === 'photo')
        .map((s) => [s.id, 'data:image/jpeg;base64,YQ==']),
    ),
    transport,
    'batch',
  )
  const result = await suggestReceptionBatch(
    f.session,
    f.batchId,
    adapter,
    new AbortController().signal,
  )
  expect(result.batch?.candidates).toHaveLength(2)
  const body = JSON.parse(
    (transport.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as string,
  )
  expect(body.instructions).toBe(batchInstructions)
  expect(body.store).toBe(false)
  expect(body.max_output_tokens).toBe(8000)
  expect(body.text.format.name).toBe('garment_batch')
})

import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'
import {
  readPrintJob,
  readPrintReferences,
  type PrintJob,
} from '../../lib/engine/printing'

const tenant = randomUUID()
const referenceId = randomUUID()
const job: PrintJob = {
  id: randomUUID(),
  printer_id: randomUUID(),
  label_kind: 'item',
  reference_kind: 'item',
  reference_id: referenceId,
  copies: 1,
  status: 'queued',
  error: '',
  created_at: '2026-09-29T12:00:00Z',
  completed_at: null,
}

function fixture(reply: (url: URL) => Response) {
  const requests: URL[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    requests.push(url)
    return reply(url)
  })
  const client = createClient(
    'https://synthetic.example.test',
    'synthetic-key',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch },
    },
  )
  return { client, fetch, requests }
}

it('reads an exact job with both tenant and job filters and without print payload', async () => {
  const f = fixture(() => Response.json([job]))
  expect(await readPrintJob(f.client, tenant, job.id)).toEqual(job)
  expect(f.requests).toHaveLength(1)
  const request = f.requests[0]
  expect(request.pathname).toBe('/rest/v1/print_jobs')
  expect(request.searchParams.get('tenant_id')).toBe(`eq.${tenant}`)
  expect(request.searchParams.get('id')).toBe(`eq.${job.id}`)
  expect(request.searchParams.get('select')).not.toContain('payload')
})

it('separates a missing job from a failed or malformed read', async () => {
  const missing = fixture(() => Response.json([]))
  expect(await readPrintJob(missing.client, tenant, job.id)).toBeNull()
  const denied = fixture(() =>
    Response.json({ message: 'denied' }, { status: 403 }),
  )
  await expect(readPrintJob(denied.client, tenant, job.id)).rejects.toThrow(
    'Unable to read print job',
  )
  const malformed = fixture(() =>
    Response.json([{ ...job, status: 'unknown' }]),
  )
  await expect(readPrintJob(malformed.client, tenant, job.id)).rejects.toThrow()
  const invalid = fixture(() => Response.json([]))
  await expect(
    readPrintJob(invalid.client, tenant, 'invalid'),
  ).rejects.toThrow()
  expect(invalid.fetch).not.toHaveBeenCalled()
})

it('batches custody references per kind and tenant while retaining exact source links', async () => {
  // The same UUID across source tables must not make one kind replace another.
  const f = fixture((url) =>
    Response.json([
      {
        id: referenceId,
        reference: url.pathname.endsWith('/bag_receipts') ? '123' : 456,
      },
    ]),
  )
  const bag: PrintJob = {
    ...job,
    label_kind: 'bag',
    reference_kind: 'bag_receipt',
  }
  const garment: PrintJob = {
    ...job,
    label_kind: 'garment',
    reference_kind: 'garment_receipt',
  }
  const seller: PrintJob = {
    ...job,
    label_kind: 'onboarding',
    reference_kind: 'seller',
  }
  const references = await readPrintReferences(f.client, tenant, [
    job,
    bag,
    bag,
    garment,
    seller,
  ])
  expect(f.requests).toHaveLength(2)
  for (const request of f.requests) {
    expect(request.searchParams.get('tenant_id')).toBe(`eq.${tenant}`)
    expect(request.searchParams.get('id')).toBe(`in.(${referenceId})`)
    expect(request.searchParams.get('select')).toBe('id,reference')
  }
  expect(references.get(`bag_receipt:${referenceId}`)).toEqual({
    label: 'K-123',
    href: `/intake/bags/${referenceId}`,
  })
  expect(references.get(`garment_receipt:${referenceId}`)).toEqual({
    label: 'G-456',
    href: null,
  })
  expect(references.get(`item:${referenceId}`)).toEqual({
    label: `I-${referenceId.slice(0, 8).toUpperCase()}`,
    href: `/intake/items/${referenceId}`,
  })
  expect(references.get(`seller:${referenceId}`)).toEqual({
    label: `S-${referenceId.slice(0, 8).toUpperCase()}`,
    href: `/intake/sellers/${referenceId}`,
  })
})

it('does not invent a missing custody reference or disguise a failed read as missing', async () => {
  const bag: PrintJob = {
    ...job,
    label_kind: 'bag',
    reference_kind: 'bag_receipt',
  }
  const missing = fixture(() => Response.json([]))
  expect((await readPrintReferences(missing.client, tenant, [bag])).size).toBe(
    0,
  )
  const failed = fixture(() =>
    Response.json({ message: 'denied' }, { status: 403 }),
  )
  await expect(
    readPrintReferences(failed.client, tenant, [bag]),
  ).rejects.toThrow('Unable to read print references')
  const empty = fixture(() => Response.json([]))
  expect((await readPrintReferences(empty.client, tenant, [])).size).toBe(0)
  expect(empty.fetch).not.toHaveBeenCalled()
  await expect(
    readPrintReferences(empty.client, tenant, Array(52).fill(bag)),
  ).rejects.toThrow()
  expect(empty.fetch).not.toHaveBeenCalled()
})

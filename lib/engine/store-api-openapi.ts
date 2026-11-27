import { z } from 'zod'
import base from './store-api-openapi-base.json'
import {
  recordSchemas,
  requestStatus,
  storeCommands,
  type StoreCommand,
} from './store-api-contract'

const ref = (name: string) => ({ $ref: '#/components/schemas/' + name })
const json = (schema: object) => ({ 'application/json': { schema } })
const response = (description: string, schema: object) => ({
  description,
  content: json(schema),
})
const id = { type: 'string', format: 'uuid' }
const pathId = { name: 'id', in: 'path', required: true, schema: id }
const schemaFor = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' })

export function storeOpenApi() {
  const paths: Record<string, Record<string, unknown>> = structuredClone(
    base.paths,
  )
  const schemas: Record<string, unknown> = {
    ...base.components.schemas,
    RequestStatus: schemaFor(requestStatus),
  }
  const success = base.paths['/items'].get.responses['200']
  const errors = Object.fromEntries(
    Object.entries(base.paths['/items'].get.responses).filter(
      ([status]) => status !== '200',
    ),
  )
  const forbidden = response(
    'Key does not have the required permission.',
    ref('Error'),
  )
  const common = { ...errors, 403: forbidden }
  paths['/items'].get = {
    ...base.paths['/items'].get,
    description: 'Requires items:read. ' + base.paths['/items'].get.description,
    responses: { 200: success, ...common },
  }
  paths['/items/{id}'].get = {
    ...base.paths['/items/{id}'].get,
    description: 'Requires items:read.',
    responses: { ...base.paths['/items/{id}'].get.responses, 403: forbidden },
  }
  for (const [resource, schema] of Object.entries(recordSchemas)) {
    schemas[resource] = schemaFor(schema)
    const page = {
      type: 'object',
      required: ['records', 'nextCursor'],
      properties: {
        records: { type: 'array', items: ref(resource) },
        nextCursor: { ...id, nullable: true },
      },
    }
    const description =
      'Requires ' +
      resource +
      ':read. Records are restricted to the key’s store.'
    paths['/' + resource] = {
      get: {
        operationId: 'list_' + resource,
        summary: 'List ' + resource,
        description,
        parameters: base.paths['/items'].get.parameters,
        responses: {
          200: response('Page ordered by ascending ID.', page),
          ...common,
        },
      },
    }
    paths['/' + resource + '/{id}'] = {
      get: {
        operationId: 'get_' + resource,
        summary: 'Read one record (' + resource + ')',
        description,
        parameters: [pathId],
        responses: {
          200: response('Matching record.', ref(resource)),
          ...common,
          404: response('No matching record in this store.', ref('Error')),
        },
      },
    }
  }
  for (const [action, cmd] of Object.entries(storeCommands)) {
    schemas[action] = schemaFor(cmd.schema)
    const parameters: object[] = cmd.path.includes('{id}') ? [pathId] : []
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      description:
        'Generate one UUID for this change. Reuse it with the same key, path and body on retries.',
      schema: id,
    })
    const description =
      'Requires ' +
      cmd.resource +
      ':write. A second person with owner or administrator access reviews the request in Operations. Poll the returned status URL.'
    const entry = (paths[cmd.path] ??= {})
    entry[cmd.method] = {
      operationId: action,
      summary: cmd.summary,
      description: description + ' ' + commandNotes[action as StoreCommand],
      parameters,
      requestBody: { required: true, content: json(ref(action)) },
      responses: {
        202: response(
          'Request received. Approval is pending unless this is a replay.',
          {
            type: 'object',
            required: ['id', 'statusUrl'],
            properties: { id, statusUrl: { type: 'string' } },
          },
        ),
        ...common,
        409: response(
          'Changed retry payload or 200 open requests for this key.',
          ref('Error'),
        ),
        415: response('Send application/json.', ref('Error')),
      },
    }
  }
  paths['/requests/{id}'] = {
    get: {
      operationId: 'getRequestStatus',
      summary: 'Check a submitted change',
      description:
        'Use the same key that submitted the request. An executed request includes its resulting resource ID. Failed, rejected and expired requests have made no change.',
      parameters: [pathId],
      responses: {
        200: response('Current review result.', ref('RequestStatus')),
        ...errors,
        404: response('Unknown request for this key.', ref('Error')),
      },
    },
  }
  schemas.Error = {
    type: 'object',
    required: ['error'],
    properties: { error: { type: 'string' } },
  }
  return {
    ...base,
    info: {
      ...base.info,
      description:
        base.info.description +
        '\n\n### Submit a change\nEnable the matching write permission when issuing the key. To create a seller, set `REQUEST_ID` to a newly generated UUID and run:\n\n```sh\ncurl --fail-with-body -X POST "$KOMISIO_URL/api/public/v1/sellers" -H "Authorization: Bearer $KOMISIO_STORE_KEY" -H "Idempotency-Key: $REQUEST_ID" -H "Content-Type: application/json" -d \'{"name":"Example Seller","email":"seller@example.test"}\'\n```\n\nExpect HTTP 202. Another owner or administrator opens Operations, reviews the values and approves or rejects the request. GET the returned statusUrl with the same key. Requests expire after seven days. To stop selling an item, end its sale period. Correct a completed sale through a return. Seller privacy closure and payout execution use their established store workflows. API keys cannot delete historical records.',
    },
    components: { ...base.components, schemas },
    paths,
  }
}
const commandNotes: Record<StoreCommand, string> = {
  createSeller: 'Supply a name and at least one contact method.',
  editSeller:
    'Supply expectedRevision from GET /sellers/{id} and at least one of name, email or phone. Omitted contact fields retain their current values.',
  createItem:
    'Specify the existing seller ID, a title and the catalogue price in minor units. For full intake, supply the existing bagId. Store agreement and seller approval requirements apply.',
  editItem:
    'Supply title with expectedTitle, priceMinor with expectedPriceMinor, or both pairs. The reason is recorded. Stale changes fail.',
  endItem:
    'Use return or charity as the end action. The inventory record and sale evidence are preserved.',
  recordSale:
    'One line per item. Send actual final prices in minor units and one stable external receipt ID per store. The sale is recorded under manual with a store-api: receipt prefix. Use the original POS integration for receipts already imported there.',
  recordReturn:
    'Use a line ID from GET /sales/{id}. The full refund is recorded as a separate event against that line.',
}

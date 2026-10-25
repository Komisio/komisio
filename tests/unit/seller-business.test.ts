import { importSellersPayload as stagedImport } from '../../lib/engine/operations'
import { expect, it } from 'vitest'
import {
  businessDetails,
  businessFromFields,
} from '../../lib/engine/seller-business'
import {
  initialSellerProfile,
  sellerProfileBody,
} from '../../lib/engine/seller-profile'
import { intakeCommand } from '../../lib/engine/intake'
import { guessMapping, mapRows } from '../../lib/engine/import-sellers'
import { selectVatMode } from '../../lib/engine/vat'

const profile = initialSellerProfile({
  name: 'Synthetic',
  email: 'test@example.test',
  phone: '',
})
it('allows optional business identifiers without permitting business fields on a private seller', () => {
  expect(
    sellerProfileBody.parse({
      ...profile,
      sellerType: 'business',
      business: {},
    }).business,
  ).toEqual(businessDetails.parse({}))
  expect(
    sellerProfileBody.safeParse({ ...profile, business: {} }).success,
  ).toBe(false)
  expect(businessDetails.safeParse({ vatRegistered: 'true' }).success).toBe(
    false,
  )
  expect(businessDetails.safeParse({ vatNumber: 'x'.repeat(81) }).success).toBe(
    false,
  )
  expect(businessDetails.safeParse({ invoiceEmail: 'bad' }).success).toBe(false)
})
it('reads only an explicit checked VAT fact from the form', () => {
  const f = new FormData()
  f.set('sellerType', 'business')
  f.set('companyName', ' Company ')
  expect(businessFromFields(f).business?.vatRegistered).toBe(false)
  f.set('vatRegistered', 'on')
  expect(businessFromFields(f).business?.vatRegistered).toBe(true)
  expect(businessFromFields(f).business?.companyName).toBe('Company')
  f.set('sellerType', 'private')
  expect(businessFromFields(f)).toEqual({ sellerType: 'private' })
})
it('keeps the registration command bounded and rejects private business metadata', () => {
  const command = {
    action: 'registerSeller',
    tenantId: 'f0000000-0000-4000-8000-000000000001',
    requestId: 'f0000000-0000-4000-8000-000000000002',
    name: profile.name,
    email: profile.email,
    phone: '',
  }
  expect(
    intakeCommand.safeParse({ ...command, sellerType: 'business' }).success,
  ).toBe(true)
  expect(
    intakeCommand.safeParse({
      ...command,
      sellerType: 'private',
      business: { companyName: 'Unexpected' },
    }).success,
  ).toBe(false)
})
it('imports explicit seller types and never silently guesses an invalid taxable flag', () => {
  const header = [
    'name',
    'email',
    'sellerType',
    'companyName',
    'vatRegistered',
    'vatNumber',
  ]
  const rows = [
    header,
    [
      'Company',
      'company@example.test',
      'business',
      'Synthetic',
      'true',
      'XX123',
    ],
    ['Wrong', 'wrong@example.test', 'private', 'Company', 'true', ''],
    ['Invalid', 'invalid@example.test', 'business', '', 'yes', ''],
  ]
  const result = mapRows(rows, guessMapping(header), true)
  expect(result.accepted).toHaveLength(1)
  expect(
    stagedImport.parse({ source: 'test.csv', rows: result.accepted }).rows[0]
      .business?.vatRegistered,
  ).toBe(true)
  expect(result.accepted[0].business).toMatchObject({
    companyName: 'Synthetic',
    vatRegistered: true,
    vatNumber: 'XX123',
  })
  expect(result.rejected).toEqual([
    { line: 3, reason: 'business' },
    { line: 4, reason: 'business' },
  ])
})
it('uses the configured business VAT mode independently of private VAT policy', () => {
  const taxable = {
    ownership: 'consignment',
    sellerTaxable: true,
    marginAttested: false,
  }
  expect(selectVatMode(taxable, {})).toBe('consignment_business')
  expect(
    selectVatMode(taxable, {
      vatModeConsignmentBusiness: 'consignment_margin',
    }),
  ).toBe('consignment_margin')
  expect(
    selectVatMode(
      { ...taxable, sellerTaxable: false },
      {
        vatModeConsignmentPrivate: 'consignment_full',
        vatModeConsignmentBusiness: 'consignment_margin',
      },
    ),
  ).toBe('consignment_full')
})

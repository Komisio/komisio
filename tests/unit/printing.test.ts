import { expect, it } from 'vitest'
import {
  referenceFormat,
  renderLabel,
  zplText,
} from '../../lib/labels/templates'
import {
  queuePrintJobInput,
  registerPrinterCommand,
} from '../../lib/engine/printing'
import { intakeCommand } from '../../lib/engine/intake'

it('renders fixed ZPL programs with machine-readable references', () => {
  const bag = renderLabel('bag', {
    storeName: 'Synthetic Store',
    reference: 'K-12',
    date: '2026-09-13',
  })
  expect(bag.startsWith('^XA')).toBe(true)
  expect(bag.endsWith('^XZ')).toBe(true)
  expect(bag).toContain('^FDK-12^FS')
  expect(bag).toContain('^BCN')
  const item = renderLabel('item', {
    storeName: 'Synthetic Store',
    reference: 'I-ABCD1234',
    line1: 'G-7',
    price: '250.00',
  })
  expect(item).toContain('^FD250.00 SEK^FS')
  const onboarding = renderLabel('onboarding', {
    storeName: 'Synthetic Store',
    reference: 'S-1',
    line1: 'Anna',
    qr: 'https://example.test/intake/sellers/x',
  })
  expect(onboarding).toContain('^BQN')
})
it('strips ZPL control characters from every dynamic value', () => {
  expect(zplText('Evil^XZ~JR store')).toBe('EvilXZJR store')
  const label = renderLabel('bag', {
    storeName: 'Evil^XZ',
    reference: 'K-1~JR',
  })
  expect(label).not.toContain('^XZ~')
  expect(label).toContain('^FDEvilXZ^FS')
  expect(label).toContain('^FDK-1JR^FS')
})
it('validates printer registration and job requests', () => {
  const base = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
  }
  expect(
    intakeCommand.parse({
      action: 'registerPrinter',
      ...base,
      name: 'Counter',
      transport: 'tcp',
      address: '192.168.1.50:9100',
    }).action,
  ).toBe('registerPrinter')
  expect(
    registerPrinterCommand.safeParse({
      action: 'registerPrinter',
      ...base,
      name: 'Counter',
      transport: 'tcp',
      dpi: 150,
    }).success,
  ).toBe(false)
  const ref = '33333333-3333-4333-8333-333333333333'
  expect(
    queuePrintJobInput.parse({
      ...base,
      printerId: ref,
      kind: 'bag',
      referenceKind: 'bag_receipt',
      referenceId: ref,
    }).copies,
  ).toBe(1)
  expect(
    queuePrintJobInput.safeParse({
      ...base,
      printerId: ref,
      kind: 'bag',
      referenceKind: 'item',
      referenceId: ref,
    }).success,
  ).toBe(false)
  expect(
    queuePrintJobInput.safeParse({
      ...base,
      printerId: ref,
      kind: 'item',
      referenceKind: 'item',
      referenceId: ref,
      copies: 21,
    }).success,
  ).toBe(false)
})

it('scales the layout to the label size at the printer resolution', () => {
  const facts = { storeName: 'Synthetic Store', reference: 'K-12' }
  const small = renderLabel('bag', facts, referenceFormat)
  expect(small).toContain('^PW464')
  expect(small).toContain('^LL320')
  const large = renderLabel('bag', facts, {
    widthMm: 76,
    heightMm: 51,
    dpi: 203,
  })
  expect(large).toContain('^PW607')
  expect(large).toContain('^LL408')
  // Scale 1.275 (the height bounds it); the first text field moves and grows.
  expect(large).toContain('^FO26,26^A0N,36,36^FD')
  const fine = renderLabel(
    'item',
    { ...facts, price: '250.00' },
    { widthMm: 57, heightMm: 32, dpi: 300 },
  )
  expect(fine).toContain('^PW673')
  expect(fine).toContain('^LL378')
  expect(fine).toContain('^FD250.00 SEK^FS')
  expect(() =>
    renderLabel('bag', facts, { widthMm: 10, heightMm: 32, dpi: 203 }),
  ).toThrow()
})

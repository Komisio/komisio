import type { FlowStepId } from '@/lib/engine/store-flow'
export const flowLinks: Record<FlowStepId, string> = {
  arrive: '/intake/sellers',
  receive: '/intake',
  wait: '/intake#bag-queue',
  register: '/intake#bag-queue',
  review: '/intake/operations',
  label: '/intake/items',
  sell: '/intake/sales',
  unsold: '/intake/lifecycle',
  payout: '/intake/payouts',
}
export const flowGroups: FlowStepId[][] = [
  ['arrive', 'receive', 'wait'],
  ['register', 'review', 'label'],
  ['sell'],
  ['unsold'],
  ['payout'],
]

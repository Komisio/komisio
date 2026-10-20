import type { Dictionary } from '../i18n'

/** Send only the accounting messages needed by these client components. */
export function economicCopy(d: Dictionary) {
  return {
    economic: d.economic,
    accounting: d.accounting,
    fortnox: d.fortnox,
    leaveUnsaved: d.leaveUnsaved,
    reload: d.intake.reload,
    sales: { vatModes: d.sales.vatModes },
    consignmentFees: {
      title: d.consignmentFees.title,
      status: { reversed: d.consignmentFees.status.reversed },
    },
  }
}
export type EconomicCopy = ReturnType<typeof economicCopy>

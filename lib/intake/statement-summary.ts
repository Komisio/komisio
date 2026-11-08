import type { StatementRow } from '@/lib/engine/statements'

/** Reconcile frozen totals, independently of the statement line read limit. */
export function statementOtherChanges(
  statement: Pick<
    StatementRow,
    | 'closing_ore'
    | 'opening_ore'
    | 'credited_ore'
    | 'reversed_ore'
    | 'paid_ore'
    | 'adjustments_ore'
  >,
) {
  return (
    statement.closing_ore -
    statement.opening_ore -
    statement.credited_ore +
    statement.reversed_ore +
    statement.paid_ore -
    statement.adjustments_ore
  )
}

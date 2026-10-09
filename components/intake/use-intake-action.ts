'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { intakeCommand } from '@/lib/engine/intake'
import type { Dictionary } from '@/lib/i18n'
import { confirmsIntakeResult } from './confirmed-result'

export function useIntakeAction(d: Dictionary['intake']) {
  const router = useRouter()
  const pending = useRef<unknown>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  async function run(input: unknown): Promise<string | null> {
    if (running.current || needsReload) return null
    const command = intakeCommand.safeParse(pending.current ?? input)
    if (!command.success) {
      setError(d.invalid)
      return null
    }
    pending.current = command.data
    running.current = true
    setLocked(true)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.data),
      })
      const result = await response.json()
      if (!response.ok) {
        // A failed server/proxy response cannot confirm that a write was
        // rejected, even if it carries a familiar validation or stale-state code.
        if (response.status < 400 || response.status >= 500) {
          setError(d.failed)
          return null
        }
        // These answered transfer refusals mean the displayed item or chain
        // can no longer support this command. Keep its identity frozen and
        // inspect current facts instead of offering an endless retry. A 5xx
        // with the same text is still uncertain and follows the usual retry.
        if (
          command.data.action === 'transferItem' &&
          response.status >= 400 &&
          response.status < 500 &&
          [
            'ITEM_ENDED',
            'ITEM_NOT_ON_SALE',
            'ITEM_NOT_FOUND',
            'NOT_SAME_CHAIN',
            'TRANSFER_UNSUPPORTED',
          ].includes(result.error)
        ) {
          setNeedsReload(true)
          setError(d.recordChanged)
          return null
        }
        const definitive = [
          'STOCKTAKE_AMBIGUOUS',
          'INVALID_INPUT',
          'AGREEMENT_CHANGED',
          'POLICY_CHANGED',
          'PROFILE_CHANGED',
          'SELLER_TERMS_CHANGED',
          'MAP_CHANGED',
          'PAYOUT_NOT_REQUESTED',
          'PAYOUT_NOT_APPROVED',
          'PAYOUT_DECIDED',
          'AGREEMENT_REQUIRED',
          'INSPECTION_DRAFT_CHANGED',
          'INSPECTION_ARCHIVED',
          'INSPECTION_STATUS_UNCHANGED',
        ].includes(result.error)
        const stocktakeItemMissing =
          command.data.action === 'scanStocktake' &&
          result.error === 'ITEM_NOT_FOUND'
        if (definitive || stocktakeItemMissing) {
          pending.current = null
          setLocked(false)
        }
        if (
          result.error === 'AGREEMENT_CHANGED' ||
          [
            'AUTH_REQUIRED',
            'FORBIDDEN',
            'TENANT_CHANGED',
            'STOCKTAKE_OPEN',
            'STOCKTAKE_CHANGED',
            'STOCKTAKE_CLOSED',
            'STOCKTAKE_NOT_FOUND',
            'STOCKTAKE_PENDING',
            'BAG_PENDING_WORK',
            'BAG_PROCESSING_CHANGED',
            'BAG_COMPLETED',
            'POLICY_CHANGED',
            'PROFILE_CHANGED',
            'SELLER_TERMS_CHANGED',
            'MAP_CHANGED',
            'PAYOUT_NOT_REQUESTED',
            'PAYOUT_NOT_APPROVED',
            'PAYOUT_DECIDED',
          ].includes(result.error) ||
          result.error === 'INSPECTION_DRAFT_CHANGED' ||
          result.error === 'INSPECTION_CONTEXT_CHANGED' ||
          result.error === 'INSPECTION_ARCHIVED' ||
          result.error === 'INSPECTION_STATUS_UNCHANGED' ||
          result.error === 'INSPECTION_NOT_FOUND'
        )
          setNeedsReload(true)
        setError(
          result.error === 'STOCKTAKE_AMBIGUOUS'
            ? d.stocktakeAmbiguous
            : stocktakeItemMissing
              ? d.stocktakeItemMissing
              : result.error === 'STOCKTAKE_PENDING'
                ? d.stocktakePending
                : [
                      'STOCKTAKE_OPEN',
                      'STOCKTAKE_CHANGED',
                      'STOCKTAKE_CLOSED',
                      'STOCKTAKE_NOT_FOUND',
                    ].includes(result.error)
                  ? d.recordChanged
                  : result.error === 'BAG_PENDING_WORK'
                    ? d.bagPendingWork
                    : result.error === 'BAG_COMPLETED'
                      ? d.bagCompleted
                      : result.error === 'BAG_PROCESSING_CHANGED'
                        ? d.recordChanged
                        : [
                              'INSPECTION_ARCHIVED',
                              'INSPECTION_STATUS_UNCHANGED',
                              'INSPECTION_NOT_FOUND',
                            ].includes(result.error)
                          ? d.inspectionUnavailable
                          : result.error === 'INSPECTION_DRAFT_CHANGED'
                            ? d.inspectionChanged
                            : result.error === 'INSPECTION_CONTEXT_CHANGED'
                              ? d.changed
                              : [
                                    'PROFILE_CHANGED',
                                    'SELLER_TERMS_CHANGED',
                                    'MAP_CHANGED',
                                    'PAYOUT_NOT_REQUESTED',
                                    'PAYOUT_NOT_APPROVED',
                                    'PAYOUT_DECIDED',
                                  ].includes(result.error)
                                ? d.recordChanged
                                : result.error === 'AGREEMENT_CHANGED'
                                  ? d.agreementChanged
                                  : result.error === 'AGREEMENT_REQUIRED'
                                    ? d.agreementRequired
                                    : result.error === 'INVALID_INPUT'
                                      ? d.invalid
                                      : [
                                            'TENANT_CHANGED',
                                            'POLICY_CHANGED',
                                          ].includes(result.error)
                                        ? d.changed
                                        : [
                                              'FORBIDDEN',
                                              'AUTH_REQUIRED',
                                            ].includes(result.error)
                                          ? d.denied
                                          : d.failed,
        )
        if (result.error === 'AGREEMENT_REQUIRED') router.refresh()
        return null
      }
      if (!confirmsIntakeResult(command.data, result)) {
        setError(d.failed)
        return null
      }
      pending.current = null
      setLocked(false)
      return result.id
    } catch {
      setError(d.failed)
      return null
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { run, busy, locked, error, needsReload }
}

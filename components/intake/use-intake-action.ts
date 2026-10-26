'use client'
import { useBusyState } from '@/components/platform/work-activity'
import { useRef, useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { intakeCommand } from '@/lib/engine/intake'
import type { Dictionary } from '@/lib/i18n'
import { confirmsIntakeResult } from './confirmed-result'

export function useIntakeAction(d: Dictionary['intake']) {
  const router = useRouter()
  const pending = useRef<unknown>(null)
  const running = useRef(false)
  const [busy, setBusy] = useBusyState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const [returnUnavailable, setReturnUnavailable] = useState(false)
  const [saleVatRequired, setSaleVatRequired] = useState(false)
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
    setSaleVatRequired(false)
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
        if (result.error === 'ACCOUNTING_PAYOUT_HISTORY_REVIEW') {
          pending.current = null
          setLocked(false)
          setNeedsReload(true)
          setError(d.payoutHistoryReview)
          return null
        }
        // Only an answered refusal confirms that no sale was recorded. A lost
        // or 5xx response keeps the exact pending command for safe replay.
        if (
          command.data.action === 'recordSale' &&
          result.error === 'VAT_MODE_NOT_SET'
        ) {
          pending.current = null
          setLocked(false)
          setSaleVatRequired(true)
          setError(d.saleVatRequired)
          return null
        }
        // A confirmed return refusal means the displayed sale is stale.
        // An unanswered/5xx request above still replays its original identity.
        if (
          command.data.action === 'recordReturn' &&
          [
            'LINE_ALREADY_RETURNED',
            'SALE_NOT_COMPLETED',
            'SALE_LINE_NOT_FOUND',
          ].includes(result.error)
        ) {
          setReturnUnavailable(true)
          setNeedsReload(true)
          setError(d.recordChanged)
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
          'COLLECTION_NOT_DUE',
          'FEE_DECIDED',
          'INVALID_INPUT',
          'AGREEMENT_CHANGED',
          'POLICY_CHANGED',
          'LABEL_FIELDS_CHANGED',
          'ITEM_PRICE_CHANGED',
          'PROFILE_CHANGED',
          'SELLER_TERMS_CHANGED',
          'MAP_CHANGED',
          'PAYOUT_NOT_REQUESTED',
          'PAYOUT_NOT_APPROVED',
          'PAYOUT_BANK_REVIEW_REQUIRED',
          'PAYOUT_CHANGED',
          'PAYOUT_DECIDED',
          'AGREEMENT_REQUIRED',
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
            'ITEM_COLLECTION_CHANGED',
            'ITEM_COLLECTION_UNAVAILABLE',
            'ITEM_PERIOD_CHANGED',
            'ITEM_TRANSFER_TERMINAL',
            'STOCKTAKE_OPEN',
            'STOCKTAKE_CHANGED',
            'STOCKTAKE_CLOSED',
            'STOCKTAKE_NOT_FOUND',
            'STOCKTAKE_PENDING',
            'BAG_PENDING_WORK',
            'BAG_PROCESSING_CHANGED',
            'BAG_COMPLETED',
            'POLICY_CHANGED',
            'LABEL_FIELDS_CHANGED',
            'ITEM_PRICE_CHANGED',
            'FEE_DECIDED',
            'FEE_NOT_FOUND',
            'PROFILE_CHANGED',
            'SELLER_TERMS_CHANGED',
            'MAP_CHANGED',
            'PAYOUT_NOT_REQUESTED',
            'PAYOUT_NOT_APPROVED',
            'PAYOUT_BANK_REVIEW_REQUIRED',
            'PAYOUT_CHANGED',
            'PAYOUT_DECIDED',
          ].includes(result.error)
        )
          setNeedsReload(true)
        setError(
          result.error === 'COLLECTION_NOT_DUE'
            ? d.collectionNotDue
            : result.error === 'STOCKTAKE_AMBIGUOUS'
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
                        'ITEM_COLLECTION_CHANGED',
                        'ITEM_COLLECTION_UNAVAILABLE',
                        'ITEM_PERIOD_CHANGED',
                        'ITEM_TRANSFER_TERMINAL',
                      ].includes(result.error)
                    ? d.recordChanged
                    : result.error === 'PAYOUT_BANK_REVIEW_REQUIRED'
                      ? d.payoutBankReviewRequired
                      : result.error === 'BAG_PENDING_WORK'
                        ? d.bagPendingWork
                        : result.error === 'BAG_COMPLETED'
                          ? d.bagCompleted
                          : result.error === 'BAG_PROCESSING_CHANGED'
                            ? d.recordChanged
                            : [
                                  'PROFILE_CHANGED',
                                  'SELLER_TERMS_CHANGED',
                                  'MAP_CHANGED',
                                  'PAYOUT_NOT_REQUESTED',
                                  'PAYOUT_NOT_APPROVED',
                                  'PAYOUT_BANK_REVIEW_REQUIRED',
                                  'PAYOUT_CHANGED',
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
                                          'LABEL_FIELDS_CHANGED',
                                          'ITEM_PRICE_CHANGED',
                                        ].includes(result.error)
                                      ? d.changed
                                      : ['FORBIDDEN', 'AUTH_REQUIRED'].includes(
                                            result.error,
                                          )
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
  return {
    run,
    busy,
    locked,
    error,
    needsReload,
    returnUnavailable,
    saleVatRequired,
  }
}

import type { AllowanceUsageAccountPayload } from "../../../lib/providerUsageIpc"
import {
  blockCaption,
  blockFigure,
  causeLine,
  utilizationCaption,
  utilizationFigure,
  utilizationLabel,
  waitLabel,
} from "./overviewAllowance"

import { SegmentFigure } from "../../../components/ui/SegmentFigure"
import { Skeleton } from "../../../components/ui/Skeleton"

import "./overview.css"

/**
 * The Overview's allowance headline: one cell for each provider account,
 * with utilization on the left and the blocks that account met on the right.
 *
 * Utilization is supply consumed and overage is demand refused. The meter
 * stops at 100%, so a reader who is blocked at noon and a reader who
 * finished their day both read the same meter. Only the block count tells
 * them apart, which is why the two figures sit side by side.
 *
 * An account with no meter history shows no utilization figure. A gap is
 * never drawn as a zero.
 */
export function OverviewAllowanceTotals({
  accounts,
  spanDays,
  loading = false,
}: {
  accounts: readonly AllowanceUsageAccountPayload[]
  spanDays: number
  loading?: boolean
}) {
  if (loading) {
    return (
      <section aria-label="Allowance" aria-busy="true">
        <div className="overview-allowance">
          <AllowanceSkeleton />
        </div>
      </section>
    )
  }
  if (accounts.length === 0) {
    return (
      <section aria-label="Allowance">
        <p className="type-body text-label-secondary">
          antiburn has no allowance readings yet. A provider states its meter while you work,
          and the figures appear here.
        </p>
      </section>
    )
  }
  return (
    <section aria-label="Allowance">
      <div className="overview-allowance">
        {accounts.map((account) => (
          <AllowanceAccount
            key={`${account.provider}:${account.accountKey}`}
            account={account}
            spanDays={spanDays}
          />
        ))}
      </div>
    </section>
  )
}

function AllowanceAccount({
  account,
  spanDays,
}: {
  account: AllowanceUsageAccountPayload
  spanDays: number
}) {
  const utilization = account.utilization
  const wait = waitLabel(account.overage.waitedSeconds)
  const cause = causeLine(account.burst)
  return (
    <div className="overview-allowance-account min-w-0 border-separator">
      <p className="type-callout text-label-secondary">{account.displayName}</p>
      <dl className="overview-allowance-pair mt-[var(--space-sm)]">
        {utilization && (
          <div className="min-w-0">
            <dt className="type-caption text-label-tertiary">
              {utilizationLabel(utilization)}
            </dt>
            <dd className="type-hero-figure mt-[var(--space-xs)] whitespace-nowrap font-mono text-measure">
              <SegmentFigure>{utilizationFigure(utilization)}</SegmentFigure>
            </dd>
            <dd className="type-caption mt-[var(--space-xs)] text-label-tertiary">
              {utilizationCaption(utilization)}
            </dd>
          </div>
        )}
        <div className="min-w-0">
          <dt className="type-caption text-label-tertiary">Blocked</dt>
          <dd className="type-hero-figure mt-[var(--space-xs)] whitespace-nowrap font-mono text-measure">
            <SegmentFigure>{blockFigure(account.overage.blockCount)}</SegmentFigure>
          </dd>
          <dd className="type-caption mt-[var(--space-xs)] text-label-tertiary">
            {blockCaption(account.overage.blockCount, spanDays)}
            {wait && (
              <>
                <span aria-hidden="true"> · </span>
                {wait}
              </>
            )}
          </dd>
          {cause && (
            <dd className="type-caption mt-[var(--space-xs)] text-label-tertiary">{cause}</dd>
          )}
        </div>
      </dl>
    </div>
  )
}

function AllowanceSkeleton() {
  return (
    <div className="overview-allowance-account min-w-0 border-separator">
      <Skeleton className="h-3 w-24" />
      <div className="overview-allowance-pair mt-[var(--space-sm)]">
        <div className="min-w-0">
          <Skeleton className="mt-[var(--space-xs)] h-8 w-28" />
          <Skeleton className="mt-[var(--space-xs)] h-3 w-36 max-w-full" />
        </div>
        <div className="min-w-0">
          <Skeleton className="mt-[var(--space-xs)] h-8 w-16" />
          <Skeleton className="mt-[var(--space-xs)] h-3 w-32 max-w-full" />
        </div>
      </div>
    </div>
  )
}

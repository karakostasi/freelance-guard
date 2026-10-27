import { ExternalLink, FileText, LoaderCircle } from "lucide-react";
import { STATUS, STATUS_CLASS, STATUS_LABEL, euro, formatDate, formatDuration, jobTotal, paidOutcome, txUrl, type Job } from "../lib/jobs";
import { formatAmount, formatUnitsOf, tokenOf, toEur } from "../lib/tokens";
import type { JobTrace, TxInfo } from "../hooks/useJobTrace";
import { DeliverableView } from "./DocView";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import styles from "../App.module.css";
import page from "./FlowPage.module.css";

// Tiny amounts would round to "€0.00", which looks like a bug.
const approxEuro = (n: number) => (n > 0 && n < 0.01 ? "< €0.01" : `≈ ${euro(n)}`);

/** The link to a transaction, or a small spinner while it is still being looked up on the blockchain. */
const TxLink = ({ tx, pending }: { tx?: TxInfo; pending?: boolean }) => {
  if (tx) {
    return (
      <a className={page.txLink} href={txUrl(tx.txHash)} target="_blank" rel="noreferrer noopener">
        transaction <ExternalLink size={12} />
      </a>
    );
  }
  return pending ? (
    <span className={page.txPending} title="Looking this up on the blockchain. It can take a few seconds.">
      <LoaderCircle size={12} className={page.spin} /> finding transaction…
    </span>
  ) : null;
};

/** Everything known about one milestone: amount, timeline, deliverable and how it ended. */
export function MilestoneDetails({ job, index, trace, onRetry, loading, compact, receiptHref }: { job: Job; index: number; trace: JobTrace | undefined; onRetry?: () => void; loading?: boolean; compact?: boolean; receiptHref?: string }) {
  const { reviewPeriod } = useEscrowConfig();
  const now = useNow();
  const ms = job.milestones[index];
  const multi = job.milestones.length > 1;
  const status = STATUS[ms.status];
  const token = tokenOf(job);
  const eur = toEur(token, ms.amount);
  const left = (to: bigint) => (now >= to ? "ended" : `in ${formatDuration(to - now)}`);

  const funded = ms.status > 0;
  // The contract sets deadline = time funded + duration, so the funding time is recoverable from it.
  const fundedAt = funded ? ms.deadline - BigInt(ms.duration) : 0n;
  const reviewEnd = reviewPeriod !== undefined && ms.submittedAt > 0n ? ms.submittedAt + reviewPeriod : undefined;
  const releaser = trace?.released?.from.toLowerCase();

  const outcome = (() => {
    if (status === "Paid") return paidOutcome(job, trace?.released?.kind, releaser);
    if (status === "Refunded") return trace?.refunded?.viaArbiter ? "Refunded to the payer by the arbiter's decision" : "Refunded to the payer after the deadline passed";
    return null;
  })();
  const outcomeTx = status === "Paid" ? trace?.released : trace?.refunded;

  return (
    <div className={compact ? page.compactDetails : `${page.msDetails} ${STATUS_CLASS[ms.status]}`}>
      {!compact && (
        <div className={page.summary}>
          <span className={`${styles.badge} ${STATUS_CLASS[ms.status]}`}>{STATUS_LABEL[ms.status]}</span>
          {multi && <strong>{ms.title || "Untitled"}</strong>}
          <span>
            <span className={page.factLabel}>{multi ? "This milestone" : "Amount"}</span> <strong>{formatUnitsOf(token, ms.amount)}</strong>{" "}
            <span className={page.factLabel}>({approxEuro(eur)})</span>
          </span>
          {multi && (
            <span className={page.factLabel}>
              Total {formatAmount(job, jobTotal(job))} · {job.milestones.filter((m) => m.status === 4).length}/{job.milestones.length} paid
            </span>
          )}
        </div>
      )}

      {loading && !trace && (
        <p className={page.traceInfo} role="status">
          <LoaderCircle size={14} className={page.spin} /> Looking up this milestone&apos;s transactions on the blockchain. This can take a few seconds.
        </p>
      )}

      {!!trace?.issues?.length && (
        <p className={page.traceNotice}>
          Some transaction links couldn&apos;t be loaded ({trace.issues.join("; ")}).{" "}
          {onRetry && (
            <button className={page.linkButton} onClick={onRetry} disabled={loading}>
              {loading ? "Retrying…" : "Retry"}
            </button>
          )}
        </p>
      )}

      <dl className={page.facts}>
        {status === "Unfunded" ? (
          <>
            <dt>Time to deliver</dt>
            <dd>{formatDuration(BigInt(ms.duration))}, counted from the moment it is funded</dd>
          </>
        ) : (
          <>
            <dt>Funded</dt>
            <dd>
              {formatDate(fundedAt)} <TxLink tx={trace?.created} pending={loading && !trace?.created} />
            </dd>
            <dt>Deadline</dt>
            <dd>
              {formatDate(ms.deadline)}
              {status === "Funded" && <span className={page.factLabel}> · {now > ms.deadline ? "overdue" : left(ms.deadline)}</span>}
            </dd>
          </>
        )}

        {funded && (
          <>
            <dt>Delivered</dt>
            <dd>
              {ms.submittedAt > 0n ? (
                <>
                  {formatDate(ms.submittedAt)} <TxLink tx={trace?.submitted} pending={loading && !trace?.submitted} />
                </>
              ) : (
                <span className={page.factLabel}>Not delivered yet</span>
              )}
            </dd>
          </>
        )}
        {ms.deliverable && (
          <>
            <dt>Deliverable</dt>
            <dd className={page.wrap}>
              <DeliverableView value={ms.deliverable} />
            </dd>
          </>
        )}

        {status === "Submitted" && reviewEnd !== undefined && (
          <>
            <dt>Review</dt>
            <dd>
              Ends {formatDate(reviewEnd)} <span className={page.factLabel}>· {left(reviewEnd)}</span>
            </dd>
          </>
        )}
        {status === "Disputed" && (
          <>
            <dt>Review</dt>
            <dd>The payer disputed the work. Waiting for the arbiter.</dd>
          </>
        )}
        {outcome && (
          <>
            <dt>{status === "Paid" ? "Paid" : "Refunded"}</dt>
            <dd>
              {outcome}
              {outcomeTx && <span className={page.factLabel}> · {formatDate(BigInt(outcomeTx.blockTime))}</span>} <TxLink tx={outcomeTx} pending={loading && !outcomeTx} />
              {status === "Paid" && receiptHref && (
                <>
                  {" "}
                  <a className={page.txLink} href={receiptHref}>
                    receipt <FileText size={12} />
                  </a>
                </>
              )}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

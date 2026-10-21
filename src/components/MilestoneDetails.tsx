import { ExternalLink } from "lucide-react";
import { STATUS, STATUS_CLASS, STATUS_LABEL, deliverableUrl, euro, formatDate, formatDuration, jobTotal, txUrl, type Job } from "../lib/jobs";
import { formatAmount, formatUnitsOf, tokenOf, toEur } from "../lib/tokens";
import type { JobTrace, TxInfo } from "../hooks/useJobTrace";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import styles from "../App.module.css";
import page from "./FlowPage.module.css";

// Tiny amounts would round to "€0.00", which looks like a bug.
const approxEuro = (n: number) => (n > 0 && n < 0.01 ? "< €0.01" : `≈ ${euro(n)}`);

const TxLink = ({ tx }: { tx?: TxInfo }) =>
  tx ? (
    <a className={page.txLink} href={txUrl(tx.txHash)} target="_blank" rel="noreferrer noopener">
      transaction <ExternalLink size={12} />
    </a>
  ) : null;

/** Everything known about one milestone: amount, timeline, deliverable and how it ended. */
export function MilestoneDetails({ job, index, trace, onRetry, loading }: { job: Job; index: number; trace: JobTrace | undefined; onRetry?: () => void; loading?: boolean }) {
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
  const link = ms.deliverable ? deliverableUrl(ms.deliverable) : null;
  const releaser = trace?.released?.from.toLowerCase();

  const outcome = (() => {
    if (status === "Paid") {
      if (trace?.released?.kind === "Resolved") return "Resolved by the arbiter in favour of the freelancer";
      if (releaser === job.freelancer.toLowerCase()) return "Claimed by the freelancer after the review period";
      if (releaser === job.client.toLowerCase()) return "Approved by the client";
      return "Paid to the freelancer";
    }
    if (status === "Refunded") return trace?.refunded?.viaArbiter ? "Refunded to the client by the arbiter's decision" : "Refunded to the client after the deadline passed";
    return null;
  })();
  const outcomeTx = status === "Paid" ? trace?.released : trace?.refunded;

  return (
    <div className={`${page.msDetails} ${STATUS_CLASS[ms.status]}`}>
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

      {trace?.unavailable && (
        <p className={page.traceNotice}>
          Transaction links are unavailable{trace.error ? `: ${trace.error}` : ""}.{" "}
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
              {formatDate(fundedAt)} <TxLink tx={trace?.created} />
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
                  {formatDate(ms.submittedAt)} <TxLink tx={trace?.submitted} />
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
              {link ? (
                <a className={page.txLink} href={link} target="_blank" rel="noreferrer noopener">
                  {ms.deliverable} <ExternalLink size={12} />
                </a>
              ) : (
                ms.deliverable
              )}
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
            <dd>The client disputed the work. Waiting for the arbiter.</dd>
          </>
        )}
        {outcome && (
          <>
            <dt>{status === "Paid" ? "Paid" : "Refunded"}</dt>
            <dd>
              {outcome}
              {outcomeTx && <span className={page.factLabel}> · {formatDate(BigInt(outcomeTx.blockTime))}</span>} <TxLink tx={outcomeTx} />
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

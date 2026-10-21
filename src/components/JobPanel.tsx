import { useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { escrowAbi, escrowAddress } from "../wagmi";
import { formatAmount } from "../lib/tokens";
import { STATUS, STATUS_CLASS, STATUS_LABEL, formatDate, formatDuration, jobTotal, roleOf, timeInfo, type Job, type Milestone } from "../lib/jobs";
import { navigate } from "../hooks/useHashRoute";
import { DeliverableView, SpecView } from "./DocView";
import { JobActions } from "./JobActions";
import { jobTitle } from "../lib/documents";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import styles from "../App.module.css";

type RawJob = readonly [Omit<Job, "milestones">, readonly Milestone[]];

export function JobPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { address } = useAccount();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data, isLoading, error: readError } = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getJob",
    args: [BigInt(id || 0)],
  });
  const raw = data as RawJob | undefined;
  const job: Job | undefined = raw && { ...raw[0], milestones: [...raw[1]] };

  const { reviewPeriod } = useEscrowConfig();
  const now = useNow();

  const me = address?.toLowerCase();
  const isClient = job && me === job.client.toLowerCase();
  const isFreelancer = job && me === job.freelancer.toLowerCase();
  const exists = !!job && job.milestones.length > 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <section className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{job ? jobTitle(job.description, id) : `Job #${id}`}</h2>
          <span className={styles.muted}>Job #{id}</span>
          {job && exists && <span className={`${styles.role} ${roleOf(job, me).className}`}>{roleOf(job, me).label}</span>}
        </div>
        {isLoading && <p>Loading…</p>}
        {readError && <p className={styles.error}>{readError.message.split("\n")[0]}</p>}
        {job && exists && (
          <>
            <p>
              Client: {job.client} {isClient && <span className={`${styles.role} ${styles.roleClient}`}>You</span>}
            </p>
            <p>
              Freelancer: {job.freelancer} {isFreelancer && <span className={`${styles.role} ${styles.roleFreelancer}`}>You</span>}
            </p>
            <p>
              {roleOf(job, me).amountLabel}: {formatAmount(job, jobTotal(job))} in {job.milestones.length} milestone{job.milestones.length > 1 ? "s" : ""}
            </p>
            <SpecView description={job.description} />

            <div className={styles.milestones}>
              {job.milestones.map((ms, i) => {
                const hint = timeInfo(ms, reviewPeriod, now);
                return (
                  <div key={i} className={`${styles.milestone} ${STATUS_CLASS[ms.status]}`}>
                    <div className={styles.milestoneHead}>
                      <strong>
                        {i + 1}. {ms.title || "Milestone"}
                      </strong>
                      <span className={`${styles.badge} ${STATUS_CLASS[ms.status]}`}>{STATUS_LABEL[ms.status]}</span>
                    </div>
                    <span>{formatAmount(job, ms.amount)}</span>
                    <span className={styles.muted}>
                      {STATUS[ms.status] === "Unfunded"
                        ? `${formatDuration(BigInt(ms.duration))} to deliver once funded`
                        : STATUS[ms.status] === "Funded"
                          ? `Deadline ${formatDate(ms.deadline)}`
                          : ms.submittedAt > 0n
                            ? `Submitted ${formatDate(ms.submittedAt)}`
                            : ""}
                      {hint && STATUS[ms.status] !== "Unfunded" ? ` · ${hint}` : ""}
                    </span>
                    {ms.deliverable && (
                      <div className={styles.deliverableRow}>
                        <span className={styles.muted}>Deliverable</span>
                        <DeliverableView value={ms.deliverable} />
                      </div>
                    )}
                    <JobActions id={id} index={i} job={job} />
                  </div>
                );
              })}
            </div>

            <button
              className={styles.ghostButton}
              onClick={() => {
                onClose();
                navigate(`/flow/${id}`);
              }}
            >
              View payment flow
            </button>
          </>
        )}
      </section>
    </div>
  );
}

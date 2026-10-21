import { useAccount } from "wagmi";
import { jobTitle } from "../lib/documents";
import { formatAmount } from "../lib/tokens";
import { STATUS_CLASS, STATUS_LABEL, currentMilestone, isDone, jobTotal, roleOf, short, timeInfo } from "../lib/jobs";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useMyJobs } from "../hooks/useMyJobs";
import { useNow } from "../hooks/useNow";
import styles from "../App.module.css";

export function MyJobs({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { address } = useAccount();
  const { reviewPeriod } = useEscrowConfig();
  const now = useNow(30_000);
  const mine = useMyJobs();
  const me = address?.toLowerCase();

  return (
    <section className={styles.section}>
      <h2>My jobs</h2>
      {mine.length === 0 && <p>No jobs for this account yet.</p>}
      <div className={styles.cards}>
        {mine.map(({ id, job }) => {
          const isClient = job.client.toLowerCase() === me;
          const role = roleOf(job, me);
          const title = jobTitle(job.description, id);
          const current = job.milestones[currentMilestone(job)];
          const finished = job.milestones.every(isDone);
          const paid = job.milestones.filter((m) => m.status === 4).length;
          const hint = finished ? "" : timeInfo(current, reviewPeriod, now);
          const label = finished ? (paid === job.milestones.length ? "Completed" : "Closed") : STATUS_LABEL[current.status];
          const tone = finished ? STATUS_CLASS[paid === job.milestones.length ? 4 : 5] : STATUS_CLASS[current.status];
          return (
            <button key={id} className={`${styles.card} ${tone} ${selected === String(id) ? styles.cardActive : ""}`} onClick={() => onSelect(String(id))}>
              <div className={styles.cardHeader}>
                <strong className={styles.cardTitle} title={title}>
                  {title}
                </strong>
                <span className={`${styles.role} ${role.className}`}>{role.label}</span>
              </div>
              <span className={styles.muted}>Job #{id}</span>
              <span className={`${styles.badge} ${tone}`}>{label}</span>
              <span>
                <span className={styles.muted}>{role.amountLabel}</span> {formatAmount(job, jobTotal(job))}
              </span>
              <span className={styles.segments} title={`${paid} of ${job.milestones.length} milestones paid`}>
                {job.milestones.map((m, i) => (
                  <span key={i} className={`${styles.segment} ${STATUS_CLASS[m.status]}`} />
                ))}
              </span>
              <span className={styles.muted}>
                {paid}/{job.milestones.length} milestones paid
              </span>
              <span className={styles.muted}>
                {isClient ? "Freelancer" : "Client"}: {short(isClient ? job.freelancer : job.client)}
              </span>
              {hint && (
                <span className={styles.muted}>
                  {job.milestones.length > 1 ? `Milestone ${currentMilestone(job) + 1}: ` : ""}
                  {hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

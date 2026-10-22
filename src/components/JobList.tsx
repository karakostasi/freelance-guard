import { useAccount } from "wagmi";
import { jobTitle } from "../lib/documents";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import { STATUS_CLASS, jobSummary, jobTotal, roleOf, type Job } from "../lib/jobs";
import { reminderFor } from "../lib/reminders";
import { formatAmount } from "../lib/tokens";
import styles from "../App.module.css";
import page from "./FlowPage.module.css";

/** The account's jobs as a list down the side. The selected one is highlighted. */
export function JobList({ jobs, selectedId, onSelect, emptyText }: { jobs: { id: number; job: Job }[]; selectedId: string; onSelect: (id: string) => void; emptyText: string }) {
  const { address } = useAccount();
  const me = address?.toLowerCase();
  const { reviewPeriod } = useEscrowConfig();
  const now = useNow(30_000);

  return (
    <aside className={page.sidebar} aria-label="Your jobs">
      <div className={page.sidebarInner}>
      <h3 className={page.sidebarTitle}>
        Your jobs <span className={styles.muted}>{jobs.length}</span>
      </h3>
      {jobs.length === 0 && <p className={styles.muted}>{emptyText}</p>}
      <ul className={page.jobList}>
        {jobs.map(({ id, job }) => {
          const { paid, label, tone } = jobSummary(job);
          const role = roleOf(job, me);
          const active = selectedId === String(id);
          const reminder = reminderFor(job, me, reviewPeriod, now);
          return (
            <li key={id}>
              <button className={`${page.jobItem} ${tone} ${active ? page.jobItemActive : ""}`} onClick={() => onSelect(String(id))} aria-current={active ? "true" : undefined}>
                <span className={page.jobItemTop}>
                  <strong className={styles.cardTitle} title={jobTitle(job.description, id)}>
                    {jobTitle(job.description, id)}
                  </strong>
                  <span className={`${styles.role} ${role.className}`}>{role.label}</span>
                </span>
                <span className={styles.muted}>
                  Job #{id} · {formatAmount(job, jobTotal(job))}
                </span>
                <span className={page.jobItemBottom}>
                  <span className={`${styles.badge} ${tone}`}>{label}</span>
                  <span className={styles.muted}>
                    {paid}/{job.milestones.length} paid
                  </span>
                </span>
                {reminder && <span className={`${styles.reminder} ${styles[`reminder_${reminder.tone}`]}`}>{reminder.text}</span>}
                <span className={styles.segments}>
                  {job.milestones.map((m, i) => (
                    <span key={i} className={`${styles.segment} ${STATUS_CLASS[m.status]}`} />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      </div>
    </aside>
  );
}

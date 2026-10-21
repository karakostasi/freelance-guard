import { Plus } from "lucide-react";
import { useAccount } from "wagmi";
import { jobTitle } from "../lib/documents";
import { STATUS_CLASS, jobSummary, jobTotal, roleOf, type Job } from "../lib/jobs";
import { formatAmount } from "../lib/tokens";
import styles from "../App.module.css";
import page from "./FlowPage.module.css";

/** The account's jobs as a list down the side. The selected one is highlighted. */
export function JobList({ jobs, selectedId, onSelect, onNew, creating }: { jobs: { id: number; job: Job }[]; selectedId: string; onSelect: (id: string) => void; onNew?: () => void; creating?: boolean }) {
  const { address } = useAccount();
  const me = address?.toLowerCase();

  return (
    <aside className={page.sidebar} aria-label="Your jobs">
      <div className={page.sidebarInner}>
      <div className={page.sidebarTitleRow}>
        <h3 className={page.sidebarTitle}>
          Your jobs <span className={styles.muted}>{jobs.length}</span>
        </h3>
        {onNew && (
          <button className={`${styles.chipButton} ${creating ? styles.chipActive : ""}`} onClick={onNew} aria-pressed={creating}>
            <Plus size={12} /> New job
          </button>
        )}
      </div>
      {jobs.length === 0 && <p className={styles.muted}>{onNew ? "No jobs yet." : 'No jobs for this account yet. Use "Fund a job" to create one.'}</p>}
      <ul className={page.jobList}>
        {jobs.map(({ id, job }) => {
          const { paid, label, tone } = jobSummary(job);
          const role = roleOf(job, me);
          const active = selectedId === String(id);
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

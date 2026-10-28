import { useAccount } from "wagmi";
import { Plus } from "lucide-react";
import { JobDetails } from "./JobDetails";
import { JobList } from "./JobList";
import { WalletCard } from "./WalletCard";
import { useMyJobs } from "../hooks/useMyJobs";
import { navigate } from "../hooks/useHashRoute";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import { jobTitle } from "../lib/documents";
import { reminderFor } from "../lib/reminders";
import styles from "../App.module.css";
import page from "./FlowPage.module.css";

/** Your jobs as a list, with the selected one beside it: what to do next on it, its stages and its details. */
export function JobsPage({ jobId }: { jobId?: string }) {
  const mine = useMyJobs();
  const { address } = useAccount();
  const { reviewPeriod } = useEscrowConfig();
  const now = useNow(30_000);
  // The job in the link, or else the newest one.
  const open = jobId ?? (mine[0] ? String(mine[0].id) : "");
  // Jobs where you can act right now because a deadline or review period has passed.
  const due = mine.flatMap(({ id, job }) => {
    const r = reminderFor(job, address, reviewPeriod, now);
    return r?.tone === "action" ? [{ id, title: jobTitle(job.description, id), text: r.text }] : [];
  });

  return (
    <div className={page.jobsLayout}>
      <JobList jobs={mine} selectedId={open} onSelect={(id) => navigate(`/jobs/${id}`)} emptyText="No jobs yet." />
      <WalletCard className={page.wallet} />
      <div className={page.top}>
        {due.length > 0 && (
          <div className={styles.nudges} role="status">
            {due.map((d) => (
              <button key={d.id} className={styles.nudge} onClick={() => navigate(`/jobs/${d.id}`)}>
                <strong>{d.title}</strong> · {d.text}
              </button>
            ))}
          </div>
        )}
        {open ? (
          <JobDetails key={open} id={open} />
        ) : (
          <section className={page.empty}>
            <h2>No jobs yet</h2>
            <p className={styles.muted}>Pay someone in stages, and the money is only released when you approve each one.</p>
            <button className={styles.button} onClick={() => navigate("/new")}>
              <Plus size={16} style={{ verticalAlign: "-3px" }} /> Create your first job
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

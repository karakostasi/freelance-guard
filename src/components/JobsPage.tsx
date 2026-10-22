import { useState } from "react";
import { HireForm } from "./HireForm";
import { JobDetails } from "./JobDetails";
import { JobList } from "./JobList";
import { WalletCard } from "./WalletCard";
import { useMyJobs } from "../hooks/useMyJobs";
import { navigate } from "../hooks/useHashRoute";
import { useAccount } from "wagmi";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import { jobTitle } from "../lib/documents";
import { reminderFor } from "../lib/reminders";
import { setPendingPayment } from "../lib/pendingPayment";
import styles from "../App.module.css";
import page from "./FlowPage.module.css";

/** The form to hire a freelancer, with your jobs as a list beside it. Clicking a job opens it as a card over the page. */
export function JobsPage() {
  const mine = useMyJobs();
  const [open, setOpen] = useState<string | null>(null);
  const { address } = useAccount();
  const { reviewPeriod } = useEscrowConfig();
  const now = useNow(30_000);
  // Jobs where you can act right now because a deadline or review period has passed.
  const due = mine.flatMap(({ id, job }) => {
    const r = reminderFor(job, address, reviewPeriod, now);
    return r?.tone === "action" ? [{ id, title: jobTitle(job.description, id), text: r.text }] : [];
  });

  return (
    <div className={page.jobsLayout}>
      <JobList jobs={mine} selectedId={open ?? ""} onSelect={setOpen} emptyText="No jobs yet. Fill in the form to hire someone." />
      <WalletCard className={page.wallet} />
      <div className={page.top}>
        {due.length > 0 && (
          <div className={styles.nudges} role="status">
            {due.map((d) => (
              <button key={d.id} className={styles.nudge} onClick={() => setOpen(String(d.id))}>
                <strong>{d.title}</strong> · {d.text}
              </button>
            ))}
          </div>
        )}
        <div className={page.formWrap}>
          <HireForm
            onBank={(form) => {
              setPendingPayment(form);
              navigate("/flow");
            }}
          />
        </div>
      </div>
      {open && <JobDetails key={open} id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

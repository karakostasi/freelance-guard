import { useState } from "react";
import { HireForm } from "./HireForm";
import { JobDetails } from "./JobDetails";
import { JobList } from "./JobList";
import { WalletCard } from "./WalletCard";
import { useMyJobs } from "../hooks/useMyJobs";
import { navigate } from "../hooks/useHashRoute";
import { setPendingPayment } from "../lib/pendingPayment";
import page from "./FlowPage.module.css";

/** The form to hire a freelancer, with your jobs as a list beside it. Clicking a job opens it as a card over the page. */
export function JobsPage() {
  const mine = useMyJobs();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className={page.jobsLayout}>
      <JobList jobs={mine} selectedId={open ?? ""} onSelect={setOpen} emptyText="No jobs yet. Fill in the form to hire someone." />
      <WalletCard className={page.wallet} />
      <div className={page.top}>
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

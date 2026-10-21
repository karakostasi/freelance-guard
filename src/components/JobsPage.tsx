import { useState } from "react";
import { HireForm } from "./HireForm";
import { JobDetails } from "./JobDetails";
import { JobList } from "./JobList";
import { useMyJobs } from "../hooks/useMyJobs";
import { navigate } from "../hooks/useHashRoute";
import { setPendingPayment } from "../lib/pendingPayment";
import page from "./FlowPage.module.css";

/** Your jobs as a list on the left. On the right: the selected job, or the form to hire someone. */
export function JobsPage() {
  const mine = useMyJobs();
  // A job id, "new", or null for the default (your newest job, or the form if you have none).
  const [choice, setChoice] = useState<string | null>(null);
  // How many jobs there were when a wallet job was just sent, so the new one can be shown once it lands.
  const [jobsBefore, setJobsBefore] = useState<number | null>(null);

  const justCreated = jobsBefore !== null && mine.length > jobsBefore;
  const selectedId =
    justCreated && (choice === "new" || choice === null) ? String(mine[0].id) : (choice ?? (mine.length > 0 ? String(mine[0].id) : "new"));
  const creating = selectedId === "new";

  return (
    <div className={page.jobsLayout}>
      <JobList
        jobs={mine}
        selectedId={selectedId}
        onSelect={setChoice}
        creating={creating}
        onNew={() => {
          setChoice("new");
          setJobsBefore(null);
        }}
      />
      <div className={page.top}>
        {creating ? (
          <div className={page.formWrap}>
            <HireForm
              onBank={(form) => {
                setPendingPayment(form);
                navigate("/flow");
              }}
              onCreated={() => setJobsBefore(mine.length)}
            />
          </div>
        ) : (
          <JobDetails key={selectedId} id={selectedId} />
        )}
      </div>
    </div>
  );
}

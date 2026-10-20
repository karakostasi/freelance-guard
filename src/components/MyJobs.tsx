import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { STATUS_CLASS, STATUS_LABEL, roleOf, short, timeInfo } from "../lib/jobs";
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
          const isClient = job[0].toLowerCase() === me;
          const hint = timeInfo(job, reviewPeriod, now);
          const role = roleOf(job, me);
          return (
            <button
              key={id}
              className={`${styles.card} ${STATUS_CLASS[job[5]]} ${selected === String(id) ? styles.cardActive : ""}`}
              onClick={() => onSelect(String(id))}
            >
              <div className={styles.cardHeader}>
                <strong>Job #{id}</strong>
                <span className={`${styles.role} ${role.className}`}>{role.label}</span>
              </div>
              <span className={`${styles.badge} ${STATUS_CLASS[job[5]]}`}>{STATUS_LABEL[job[5]]}</span>
              <span>
                <span className={styles.muted}>{role.amountLabel}</span>{" "}
                {formatEther(job[2])} ETH
              </span>
              <span className={styles.muted}>
                {isClient ? "Freelancer" : "Client"}: {short(isClient ? job[1] : job[0])}
              </span>
              {hint && <span className={styles.muted}>{hint}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

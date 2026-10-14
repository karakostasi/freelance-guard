import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatEther, type Abi } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { STATUS, STATUS_CLASS, STATUS_LABEL, roleOf, short, timeInfo, type Job } from "../lib/jobs";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import styles from "../App.module.css";

export function MyJobs({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { address } = useAccount();
  const { data: count } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "jobCount" });
  const total = Number(count ?? 0n);
  const { data } = useReadContracts({
    contracts: Array.from({ length: total }, (_, i) => ({
      address: escrowAddress,
      abi: escrowAbi as Abi,
      functionName: "jobs",
      args: [BigInt(i + 1)],
    })),
    query: { enabled: total > 0 },
  });

  const { reviewPeriod, arbiter } = useEscrowConfig();
  const now = useNow(30_000);

  const me = address?.toLowerCase();
  const isArbiter = !!me && arbiter?.toLowerCase() === me;
  const mine = (data ?? [])
    .map((r, i) => ({ id: i + 1, job: r.result as Job | undefined }))
    .filter(
      ({ job }) =>
        job && (job[0].toLowerCase() === me || job[1].toLowerCase() === me || (isArbiter && STATUS[job[5]] === "Disputed")),
    )
    .reverse();

  return (
    <section className={styles.section}>
      <h2>My jobs</h2>
      {mine.length === 0 && <p>No jobs for this account yet.</p>}
      <div className={styles.cards}>
        {mine.map(({ id, job }) => {
          const isClient = job![0].toLowerCase() === me;
          const hint = timeInfo(job!, reviewPeriod, now);
          const role = roleOf(job!, me);
          return (
            <button
              key={id}
              className={`${styles.card} ${STATUS_CLASS[job![5]]} ${selected === String(id) ? styles.cardActive : ""}`}
              onClick={() => onSelect(String(id))}
            >
              <div className={styles.cardHeader}>
                <strong>Job #{id}</strong>
                <span className={`${styles.role} ${role.className}`}>{role.label}</span>
              </div>
              <span className={`${styles.badge} ${STATUS_CLASS[job![5]]}`}>{STATUS_LABEL[job![5]]}</span>
              <span>
                <span className={styles.muted}>{role.amountLabel}</span>{" "}
                {formatEther(job![2])} ETH
              </span>
              <span className={styles.muted}>
                {isClient ? "Freelancer" : "Client"}: {short(isClient ? job![1] : job![0])}
              </span>
              {hint && <span className={styles.muted}>{hint}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

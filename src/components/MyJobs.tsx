import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatEther, type Abi } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { STATUS, STATUS_CLASS, short, type Job } from "../lib/jobs";
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

  const me = address?.toLowerCase();
  const mine = (data ?? [])
    .map((r, i) => ({ id: i + 1, job: r.result as Job | undefined }))
    .filter(({ job }) => job && (job[0].toLowerCase() === me || job[1].toLowerCase() === me))
    .reverse();

  return (
    <section className={styles.section}>
      <h2>My jobs</h2>
      {mine.length === 0 && <p>No jobs for this account yet.</p>}
      <div className={styles.cards}>
        {mine.map(({ id, job }) => {
          const isClient = job![0].toLowerCase() === me;
          return (
            <button
              key={id}
              className={`${styles.card} ${STATUS_CLASS[job![5]]} ${selected === String(id) ? styles.cardActive : ""}`}
              onClick={() => onSelect(String(id))}
            >
              <strong>Job #{id}</strong>
              <span className={`${styles.badge} ${STATUS_CLASS[job![5]]}`}>{STATUS[job![5]]}</span>
              <span>{formatEther(job![2])} ETH</span>
              <span className={styles.muted}>
                {isClient ? "You hired" : "Hired by"} {short(isClient ? job![1] : job![0])}
              </span>
              <span className={styles.muted}>{isClient ? "Client" : "Freelancer"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

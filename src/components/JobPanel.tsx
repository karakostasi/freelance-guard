import { useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { formatEther } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { STATUS, STATUS_CLASS, STATUS_LABEL, formatDate, formatDuration, roleOf, type Job } from "../lib/jobs";
import { navigate } from "../hooks/useHashRoute";
import { JobActions } from "./JobActions";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import styles from "../App.module.css";

export function JobPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { address } = useAccount();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data, isLoading, error: readError } = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "jobs",
    args: [BigInt(id || 0)],
  });
  const job = data as Job | undefined;

  const { reviewPeriod } = useEscrowConfig();
  const now = useNow();

  const me = address?.toLowerCase();
  const isClient = job && me === job[0].toLowerCase();
  const isFreelancer = job && me === job[1].toLowerCase();
  const status = job ? STATUS[job[5]] : "";

  const deadline = job?.[3] ?? 0n;
  const reviewEnd = job && reviewPeriod !== undefined ? job[4] + reviewPeriod : undefined;

  return (
    <div className={styles.overlay} onClick={onClose}>
    <section className={styles.modal} onClick={(e) => e.stopPropagation()}>
      <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
      <div className={styles.modalHeader}>
        <h2>Job #{id}</h2>
        {job && status !== "None" && <span className={`${styles.role} ${roleOf(job, me).className}`}>{roleOf(job, me).label}</span>}
      </div>
      {isLoading && <p>Loading…</p>}
      {readError && <p className={styles.error}>{readError.message.split("\n")[0]}</p>}
      {job && status !== "None" && (
        <>
          <p>
            Client: {job[0]} {isClient && <span className={`${styles.role} ${styles.roleClient}`}>You</span>}
          </p>
          <p>
            Freelancer: {job[1]} {isFreelancer && <span className={`${styles.role} ${styles.roleFreelancer}`}>You</span>}
          </p>
          <p>
            {roleOf(job, me).amountLabel}: {formatEther(job[2])} ETH
          </p>
          <p>Status: <span className={`${styles.badge} ${STATUS_CLASS[job[5]]}`}>{STATUS_LABEL[job[5]]}</span></p>
          <p>Spec: {job[6]}</p>
          {status === "Funded" && (
            <p>
              Deadline: {formatDate(deadline)}{" "}
              <span className={styles.muted}>({now > deadline ? "overdue" : `in ${formatDuration(deadline - now)}`})</span>
            </p>
          )}
          {job[4] > 0n && <p>Submitted: {formatDate(job[4])}</p>}
          {status === "Submitted" && reviewEnd !== undefined && (
            <p>
              Review ends: {formatDate(reviewEnd)}{" "}
              <span className={styles.muted}>({now >= reviewEnd ? "ended" : `in ${formatDuration(reviewEnd - now)}`})</span>
            </p>
          )}
          {job[7] && <p>Deliverable: {job[7]}</p>}

          <JobActions id={id} job={job} />
        </>
      )}
      {job && status !== "None" && (
        <button
          className={styles.ghostButton}
          onClick={() => {
            onClose();
            navigate(`/flow/${id}`);
          }}
        >
          View payment flow
        </button>
      )}
    </section>
    </div>
  );
}

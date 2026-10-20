import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { STATUS, STATUS_CLASS, STATUS_LABEL, formatDate, formatDuration, roleOf, type Job } from "../lib/jobs";
import { navigate } from "../hooks/useHashRoute";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import styles from "../App.module.css";

export function JobPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { address } = useAccount();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const confirming = useRefreshOnConfirm(txHash);
  const [deliverable, setDeliverable] = useState("");

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

  const call = (functionName: string, args: unknown[]) =>
    writeContract({ address: escrowAddress, abi: escrowAbi, functionName, args });

  const { reviewPeriod, arbiter } = useEscrowConfig();
  const now = useNow();
  const busy = isPending || confirming;

  const me = address?.toLowerCase();
  const isClient = job && me === job[0].toLowerCase();
  const isFreelancer = job && me === job[1].toLowerCase();
  const isArbiter = !!me && arbiter?.toLowerCase() === me;
  const status = job ? STATUS[job[5]] : "";
  const n = BigInt(id || 0);

  const deadline = job?.[3] ?? 0n;
  const reviewEnd = job && reviewPeriod !== undefined ? job[4] + reviewPeriod : undefined;

  // Each action is disabled (with a hint) when the contract would revert.
  const action = (label: string, fn: string, args: unknown[], blockedReason = "") => (
    <div className={styles.action}>
      <button className={styles.button} disabled={busy || !!blockedReason} onClick={() => call(fn, args)}>
        {label}
      </button>
      {blockedReason && <span className={styles.muted}>{blockedReason}</span>}
    </div>
  );

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

          {isFreelancer && status === "Funded" && (
            <>
              <input className={styles.input} placeholder="Deliverable link" value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
              {action("Submit work", "submitWork", [n, deliverable], now > deadline ? "Deadline passed" : !deliverable ? "Add a deliverable link" : "")}
            </>
          )}
          {isFreelancer && status === "Submitted" &&
            action("Claim payment", "claimAfterTimeout", [n], reviewEnd === undefined || now < reviewEnd ? `Available in ${formatDuration((reviewEnd ?? now) - now)}` : "")}
          {isClient && status === "Submitted" && (
            <>
              {action("Approve & pay", "approve", [n])}
              {action("Dispute", "dispute", [n], reviewEnd !== undefined && now >= reviewEnd ? "Review period ended" : "")}
            </>
          )}
          {isClient && status === "Funded" &&
            action("Refund", "refundExpired", [n], now <= deadline ? `Available in ${formatDuration(deadline - now + 1n)}` : "")}
          {status === "Disputed" && isArbiter && (
            <>
              {action("Pay freelancer", "resolve", [n, true])}
              {action("Refund client", "resolve", [n, false])}
            </>
          )}
          {status === "Disputed" && !isArbiter && <p className={styles.muted}>Waiting for the arbiter to resolve this dispute.</p>}
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
      {(isPending || confirming) && <p>Waiting for transaction…</p>}
      {error && <p className={styles.error}>{error.message.split("\n")[0]}</p>}
    </section>
    </div>
  );
}

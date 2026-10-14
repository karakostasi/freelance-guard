import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { STATUS, STATUS_CLASS, type Job } from "../lib/jobs";
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

  const isClient = job && address?.toLowerCase() === job[0].toLowerCase();
  const isFreelancer = job && address?.toLowerCase() === job[1].toLowerCase();
  const status = job ? STATUS[job[5]] : "";
  const n = BigInt(id || 0);

  return (
    <div className={styles.overlay} onClick={onClose}>
    <section className={styles.modal} onClick={(e) => e.stopPropagation()}>
      <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
      <h2>Job #{id}</h2>
      {isLoading && <p>Loading…</p>}
      {readError && <p className={styles.error}>{readError.message.split("\n")[0]}</p>}
      {job && status !== "None" && (
        <>
          <p>Client: {job[0]}</p>
          <p>Freelancer: {job[1]}</p>
          <p>Amount: {formatEther(job[2])} ETH</p>
          <p>Status: <span className={`${styles.badge} ${STATUS_CLASS[job[5]]}`}>{status}</span></p>
          <p>Spec: {job[6]}</p>
          {job[7] && <p>Deliverable: {job[7]}</p>}

          {isFreelancer && status === "Funded" && (
            <>
              <input className={styles.input} placeholder="Deliverable link" value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
              <button className={styles.button} onClick={() => call("submitWork", [n, deliverable])}>Submit work</button>
            </>
          )}
          {isFreelancer && status === "Submitted" && (
            <button className={styles.button} onClick={() => call("claimAfterTimeout", [n])}>Claim (after review period)</button>
          )}
          {isClient && status === "Submitted" && (
            <>
              <button className={styles.button} onClick={() => call("approve", [n])}>Approve & pay</button>
              <button className={styles.button} onClick={() => call("dispute", [n])}>Dispute</button>
            </>
          )}
          {isClient && status === "Funded" && (
            <button className={styles.button} onClick={() => call("refundExpired", [n])}>Refund (after deadline)</button>
          )}
        </>
      )}
      {(isPending || confirming) && <p>Waiting for transaction…</p>}
      {error && <p className={styles.error}>{error.message.split("\n")[0]}</p>}
    </section>
    </div>
  );
}

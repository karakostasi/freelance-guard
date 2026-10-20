import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { escrowAbi, escrowAddress } from "../wagmi";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { STATUS, formatDuration, type Job } from "../lib/jobs";
import styles from "../App.module.css";

/** The contract actions the connected account can take on a job right now. */
export function JobActions({ id, job }: { id: string; job: Job }) {
  const { address } = useAccount();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const confirming = useRefreshOnConfirm(txHash);
  const { reviewPeriod, arbiter } = useEscrowConfig();
  const now = useNow();
  const [deliverable, setDeliverable] = useState("");

  const busy = isPending || confirming;
  const me = address?.toLowerCase();
  const isClient = me === job[0].toLowerCase();
  const isFreelancer = me === job[1].toLowerCase();
  const isArbiter = !!me && arbiter?.toLowerCase() === me;
  const status = STATUS[job[5]];
  const n = BigInt(id || 0);

  const deadline = job[3];
  const reviewEnd = reviewPeriod !== undefined ? job[4] + reviewPeriod : undefined;

  const call = (functionName: string, args: unknown[]) =>
    writeContract({ address: escrowAddress, abi: escrowAbi, functionName, args });

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
    <>
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
      {busy && <p>Waiting for transaction…</p>}
      {error && <p className={styles.error}>{error.message.split("\n")[0]}</p>}
    </>
  );
}

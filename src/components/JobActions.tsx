import { useState } from "react";
import { useAccount } from "wagmi";
import { writeContract } from "wagmi/actions";
import { config, escrowAbi, escrowAddress } from "../wagmi";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { ensureAllowance } from "../lib/erc20";
import { STATUS, formatDuration, type Job } from "../lib/jobs";
import { tokenOf } from "../lib/tokens";
import styles from "../App.module.css";

/** The contract actions the connected account can take on one milestone right now. */
export function JobActions({ id, index, job }: { id: string; index: number; job: Job }) {
  const { address } = useAccount();
  const { reviewPeriod, arbiter } = useEscrowConfig();
  const now = useNow();
  const [deliverable, setDeliverable] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [working, setWorking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirming = useRefreshOnConfirm(txHash);

  const ms = job.milestones[index];
  const busy = !!working || confirming;
  const me = address?.toLowerCase();
  const isClient = me === job.client.toLowerCase();
  const isFreelancer = me === job.freelancer.toLowerCase();
  const isArbiter = !!me && arbiter?.toLowerCase() === me;
  const status = STATUS[ms.status];
  const n = BigInt(id || 0);
  const m = BigInt(index);

  const deadline = ms.deadline;
  const reviewEnd = reviewPeriod !== undefined ? ms.submittedAt + reviewPeriod : undefined;

  const send = async (functionName: string, args: unknown[], value?: bigint, prepare?: () => Promise<void>) => {
    setError(null);
    try {
      await prepare?.();
      setWorking("Confirm in your wallet…");
      setTxHash(await writeContract(config, { address: escrowAddress, abi: escrowAbi, functionName, args, value }));
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setWorking("");
    }
  };

  const fund = () => {
    const token = tokenOf(job);
    if (!token.address) return send("fundMilestone", [n, m], ms.amount);
    // Tokens need the escrow to be allowed to pull them first.
    return send("fundMilestone", [n, m], undefined, () => ensureAllowance(token.address!, address!, ms.amount, () => setWorking("Approve the token in your wallet…")));
  };

  // Each action is disabled (with a hint) when the contract would revert.
  const action = (label: string, onClick: () => void, blockedReason = "") => (
    <div className={styles.action}>
      <button className={styles.button} disabled={busy || !!blockedReason} onClick={onClick}>
        {label}
      </button>
      {blockedReason && <span className={styles.muted}>{blockedReason}</span>}
    </div>
  );

  return (
    <>
      {status === "Unfunded" && isClient && action("Fund this milestone", fund)}
      {status === "Unfunded" && !isClient && <p className={styles.muted}>Waiting for the client to fund this milestone.</p>}
      {isFreelancer && status === "Funded" && (
        <>
          <input className={styles.input} placeholder="Deliverable link" value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
          {action("Submit work", () => send("submitWork", [n, m, deliverable]), now > deadline ? "Deadline passed" : !deliverable ? "Add a deliverable link" : "")}
        </>
      )}
      {isFreelancer && status === "Submitted" &&
        action("Claim payment", () => send("claimAfterTimeout", [n, m]), reviewEnd === undefined || now < reviewEnd ? `Available in ${formatDuration((reviewEnd ?? now) - now)}` : "")}
      {isClient && status === "Submitted" && (
        <>
          {action("Approve & pay", () => send("approve", [n, m]))}
          {action("Dispute", () => send("dispute", [n, m]), reviewEnd !== undefined && now >= reviewEnd ? "Review period ended" : "")}
        </>
      )}
      {isClient && status === "Funded" && action("Refund", () => send("refundExpired", [n, m]), now <= deadline ? `Available in ${formatDuration(deadline - now + 1n)}` : "")}
      {status === "Disputed" && isArbiter && (
        <>
          {action("Pay freelancer", () => send("resolve", [n, m, true]))}
          {action("Refund client", () => send("resolve", [n, m, false]))}
        </>
      )}
      {status === "Disputed" && !isArbiter && <p className={styles.muted}>Waiting for the arbiter to resolve this dispute.</p>}
      {busy && <p>{working || "Waiting for transaction…"}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}

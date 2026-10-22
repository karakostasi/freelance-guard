import { useState } from "react";
import { useAccount } from "wagmi";
import type { Abi } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { useBackendStatus } from "../hooks/useBackend";
import { approvalCall } from "../lib/erc20";
import { firstLine } from "../lib/errors";
import { uploadDoc, uploadFile } from "../lib/files";
import { callOf, sendTransactions, type Call } from "../lib/tx";
import { FileDrop } from "./FileDrop";
import { STATUS, formatDuration, milestoneName, type Job } from "../lib/jobs";
import { tokenOf } from "../lib/tokens";
import styles from "../App.module.css";

/** The contract actions the connected account can take on one milestone right now. */
export function JobActions({ id, index, job }: { id: string; index: number; job: Job }) {
  const { address } = useAccount();
  const { reviewPeriod, arbiter } = useEscrowConfig();
  const now = useNow();
  const [deliverable, setDeliverable] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const { online: backendOnline } = useBackendStatus();
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
  // For multi-milestone jobs the buttons name the step, e.g. "Submit draft".
  const name = milestoneName(job, index);
  const n = BigInt(id || 0);
  const m = BigInt(index);

  const deadline = ms.deadline;
  const reviewEnd = reviewPeriod !== undefined ? ms.submittedAt + reviewPeriod : undefined;

  // What goes on-chain as the deliverable: the typed link or note as it is, or, with files, a pointer to a stored document.
  const buildDeliverable = async () => {
    const text = deliverable.trim();
    if (files.length === 0) return text;
    setWorking("Uploading files…");
    const uploaded = [];
    for (const file of files) uploaded.push(await uploadFile(file, address!));
    return `fg:${await uploadDoc({ version: 1, text, files: uploaded }, address!)}`;
  };

  // `before` is something that has to happen first, such as a token approval. It goes out together with the action
  // in a single confirmation when the wallet allows, which is what lets a passkey user confirm once.
  const send = async (functionName: string, args: unknown[] | (() => Promise<unknown[]>), value?: bigint, before?: () => Promise<Call | null>) => {
    setError(null);
    try {
      const first = await before?.();
      const resolved = typeof args === "function" ? await args() : args;
      setWorking("Confirm in your wallet…");
      const calls = [...(first ? [first] : []), callOf({ address: escrowAddress, abi: escrowAbi as Abi, functionName, args: resolved, value })];
      const { hash } = await sendTransactions(address!, calls);
      setTxHash(hash);
      setFiles([]);
      setDeliverable("");
    } catch (e) {
      setError(firstLine(e));
    } finally {
      setWorking("");
    }
  };

  const fund = () => {
    const token = tokenOf(job);
    if (!token.address) return send("fundMilestone", [n, m], ms.amount);
    // Tokens need the escrow to be allowed to pull them first.
    return send("fundMilestone", [n, m], undefined, () => approvalCall(token.address!, address!, ms.amount));
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
      {status === "Unfunded" && isClient && action(name ? `Fund ${name}` : "Fund this milestone", fund)}
      {status === "Unfunded" && !isClient && <p className={styles.muted}>Waiting for the client to fund this milestone.</p>}
      {isFreelancer && status === "Funded" && (
        <>
          <input className={styles.input} placeholder={name ? `Link or note for your ${name}` : "Deliverable link or note"} value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
          {backendOnline && <FileDrop files={files} onChange={setFiles} disabled={busy} />}
          {action(
            name ? `Submit ${name}` : "Submit work",
            () => send("submitWork", async () => [n, m, await buildDeliverable()]),
            now > deadline ? "Deadline passed" : !deliverable.trim() && files.length === 0 ? (backendOnline ? "Add a link, a note or files" : "Add a link or a note") : "",
          )}
        </>
      )}
      {isFreelancer && status === "Submitted" &&
        action(name ? `Claim ${name} payment` : "Claim payment", () => send("claimAfterTimeout", [n, m]), reviewEnd === undefined || now < reviewEnd ? `Available in ${formatDuration((reviewEnd ?? now) - now)}` : "")}
      {isClient && status === "Submitted" && (
        <>
          {action(name ? `Approve ${name} & pay` : "Approve & pay", () => send("approve", [n, m]))}
          {action("Dispute", () => send("dispute", [n, m]), reviewEnd !== undefined && now >= reviewEnd ? "Review period ended" : "")}
        </>
      )}
      {isClient && status === "Funded" && action(name ? `Refund ${name}` : "Refund", () => send("refundExpired", [n, m]), now <= deadline ? `Available in ${formatDuration(deadline - now + 1n)}` : "")}
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

import { useState } from "react";
import { useAccount } from "wagmi";
import { writeContract } from "wagmi/actions";
import { config, escrowAbi, escrowAddress } from "../wagmi";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { useBackendStatus } from "../hooks/useBackend";
import { ensureAllowance } from "../lib/erc20";
import { uploadDoc, uploadFile } from "../lib/files";
import { FileDrop } from "./FileDrop";
import { STATUS, formatDuration, hasVerifier, milestoneName, milestoneSurcharge, type Job } from "../lib/jobs";
import { formatAmount, tokenOf } from "../lib/tokens";
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
  const [problem, setProblem] = useState(false);
  const confirming = useRefreshOnConfirm(txHash);

  const ms = job.milestones[index];
  const busy = !!working || confirming;
  const me = address?.toLowerCase();
  const isPayer = me === job.payer.toLowerCase();
  const isPayee = me === job.payee.toLowerCase();
  const isVerifier = !!me && hasVerifier(job) && me === job.verifier.toLowerCase();
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

  const send = async (functionName: string, args: unknown[] | (() => Promise<unknown[]>), value?: bigint, prepare?: () => Promise<void>) => {
    setError(null);
    try {
      await prepare?.();
      const resolved = typeof args === "function" ? await args() : args;
      setWorking("Confirm in your wallet…");
      setTxHash(await writeContract(config, { address: escrowAddress, abi: escrowAbi, functionName, args: resolved, value }));
      setFiles([]);
      setDeliverable("");
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setWorking("");
    }
  };

  const fund = () => {
    const token = tokenOf(job);
    // The payer pays the milestone plus its surcharge (none for a job that takes the yield).
    const due = ms.amount + milestoneSurcharge(job, ms);
    if (!token.address) return send("fundMilestone", [n, m], due);
    // Tokens need the escrow to be allowed to pull them first.
    return send("fundMilestone", [n, m], undefined, () => ensureAllowance(token.address!, address!, due, () => setWorking("Approve the token in your wallet…")));
  };

  // Each action is disabled (with a hint) when the contract would revert.
  const action = (label: string, onClick: () => void, blockedReason = "", good = false) => (
    <div className={styles.action}>
      <button className={`${styles.button} ${good ? styles.buttonGood : ""}`} disabled={busy || !!blockedReason} onClick={onClick}>
        {label}
      </button>
      {blockedReason && <span className={styles.muted}>{blockedReason}</span>}
    </div>
  );

  return (
    <>
      {status === "Unfunded" && isPayer && action(name ? `Fund ${name}` : "Fund this milestone", fund)}
      {isPayee && status === "Funded" && (
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
      {isPayee && status === "Submitted" && (
        <>
          {action(name ? `Claim ${name} payment` : "Claim payment", () => send("claimAfterTimeout", [n, m]), reviewEnd === undefined || now < reviewEnd ? `Available in ${formatDuration((reviewEnd ?? now) - now)}` : "")}
          {(reviewEnd === undefined || now < reviewEnd) && <p className={styles.muted}>If the payer doesn&apos;t respond, you can claim the payment once the review period ends.</p>}
        </>
      )}
      {(isPayer || isVerifier) && status === "Submitted" && (
        <>
          {action(name ? `Approve ${name} and pay ${formatAmount(job, ms.amount)}` : `Approve and pay ${formatAmount(job, ms.amount)}`, () => send("approve", [n, m]), "", true)}
          {isPayer && (
            <div className={styles.action}>
              <button type="button" className={styles.textButton} aria-expanded={problem} onClick={() => setProblem((o) => !o)}>
                Something is wrong
              </button>
              {problem && (
                <div className={styles.problemBox}>
                  <b>Report a problem</b>
                  <span className={styles.muted}>The payment stays locked and the arbiter decides who gets the money. You can do this until the review period ends.</span>
                  {action("Report a problem", () => send("dispute", [n, m]), reviewEnd !== undefined && now >= reviewEnd ? "The review period ended" : "")}
                </div>
              )}
              {hasVerifier(job) && <span className={styles.muted}>This job has a verifier. If it approves first, you can no longer report a problem.</span>}
            </div>
          )}
        </>
      )}
      {/* Until the deadline passes there is nothing to do: the card above says when. After it, taking the money back is the way on. */}
      {isPayer && status === "Funded" && now > deadline && action(name ? `Take back the ${name} payment` : "Take the money back", () => send("refundExpired", [n, m]), "", true)}
      {status === "Disputed" && isArbiter && (
        <>
          {action("Pay payee", () => send("resolve", [n, m, true]))}
          {action("Refund payer", () => send("resolve", [n, m, false]))}
        </>
      )}
      {busy && <p>{working || "Waiting for transaction…"}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useAccount, useReadContract } from "wagmi";
import { writeContract } from "wagmi/actions";
import { zeroAddress } from "viem";
import { config, escrowAbi, escrowAddress } from "../wagmi";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { formatAmount } from "../lib/tokens";
import { avatarGradient } from "../lib/avatar";
import { STATUS_CLASS, STATUS_LABEL, addressUrl, amountFor, currentMilestone, hasVerifier, isDone, jobFromChain, jobTotal, milestoneSurcharge, roleOf, short, type Job, type RawJob } from "../lib/jobs";
import { navigate } from "../hooks/useHashRoute";
import { SpecView } from "./DocView";
import { ReputationBadge } from "./ReputationBadge";
import { MilestoneDetails } from "./MilestoneDetails";
import { JobActions } from "./JobActions";
import { NextStep } from "./NextStep";
import { jobTitle, parseDescription, receiptPath } from "../lib/documents";
import { useJobTrace } from "../hooks/useJobTrace";
import styles from "../App.module.css";
import j from "./JobDetails.module.css";

const PAID = 4;

/** A person in the job: avatar, short address, and buttons to copy the address or open it in the block explorer. */
function Party({ label, address, you, tone, role }: { label: string; address: string; you: boolean; tone: string; role: "payer" | "payee" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{label}</span>
      <div className={styles.partyRow}>
        <span className={styles.avatar} style={{ background: avatarGradient(address) }} />
        <span className={styles.partyText}>
          <span className={styles.partyAddress} title={address}>
            {short(address)}
          </span>
          {you && <span className={`${styles.role} ${tone}`}>You</span>}
        </span>
        <button className={styles.iconButton} onClick={copy} aria-label={`Copy the ${label.toLowerCase()}'s address`} title={copied ? "Copied!" : "Copy address"}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
        <a className={styles.iconButton} href={addressUrl(address)} target="_blank" rel="noreferrer noopener" aria-label={`Open the ${label.toLowerCase()}'s address in the block explorer`} title="View on BaseScan">
          <ExternalLink size={15} />
        </a>
      </div>
      <ReputationBadge address={address} role={role} />
    </div>
  );
}

/** The job's verifier, when it has one. The payer can take it away, which works at any time. */
function VerifierLine({ id, job, isPayer }: { id: string; job: Job; isPayer: boolean }) {
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);
  const confirming = useRefreshOnConfirm(txHash);
  const remove = async () => {
    setError(null);
    try {
      setTxHash(await writeContract(config, { address: escrowAddress, abi: escrowAbi, functionName: "setVerifier", args: [BigInt(id), zeroAddress] }));
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    }
  };
  return (
    <p className={styles.muted}>
      Verifier{" "}
      <a href={addressUrl(job.verifier)} target="_blank" rel="noreferrer noopener" title={job.verifier}>
        {short(job.verifier)}
      </a>{" "}
      can approve delivered work for the payer.{" "}
      {isPayer && !job.milestones.every(isDone) && (
        <button className={styles.chipButton} onClick={remove} disabled={confirming}>
          {confirming ? "Removing…" : "Remove verifier"}
        </button>
      )}
      {error && <span className={styles.error}> {error}</span>}
    </p>
  );
}

/** Two numbers that matter to whoever is looking: what the job is worth to them, and how much of it has moved. */
function Money({ job, me }: { job: Job; me: string | undefined }) {
  const role = roleOf(job, me).label;
  const total = jobTotal(job);
  const paid = job.milestones.filter((m) => m.status === PAID);
  const fee = job.milestones.reduce((sum, m) => sum + milestoneSurcharge(job, m), 0n);
  const mine = (units: bigint, ms: Job["milestones"][number]) => (role === "Payee" ? amountFor(job, ms, me) : units);
  const released = paid.reduce((sum, m) => sum + mine(m.amount, m), 0n);
  const first = {
    Payer: ["You pay in total", total + fee, fee > 0n ? `The job plus a ${formatAmount(job, fee)} service fee` : job.yield ? "No service fee: your money earns yield while it waits" : "The job amount"],
    Payee: ["You earn in total", total - job.fee, `After a ${formatAmount(job, job.fee)} platform fee`],
  }[role] ?? ["Total in escrow", total, "The job amount"];
  const second = role === "Payer" ? "Released to the payee" : role === "Payee" ? "You have received" : "Paid out";
  return (
    <div className={styles.tiles}>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{first[0] as string}</span>
        <strong className={j.big}>{formatAmount(job, first[1] as bigint)}</strong>
        <span className={styles.muted}>{first[2] as string}</span>
      </div>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{second}</span>
        <strong className={j.big}>{formatAmount(job, released)}</strong>
        <span className={styles.segments} title={`${paid.length} of ${job.milestones.length} paid`}>
          {job.milestones.map((m, i) => (
            <span key={i} className={`${styles.segment} ${STATUS_CLASS[m.status]}`} />
          ))}
        </span>
        <span className={styles.muted}>
          {paid.length} of {job.milestones.length} {job.milestones.length > 1 ? "stages" : "payment"} paid
        </span>
      </div>
    </div>
  );
}

/** One stage of the job: its status and what it is worth to you. It opens to the facts, the transactions and, for stages that are not next, the buttons. */
function Stage({ id, index, job, me, current }: { id: string; index: number; job: Job; me: string | undefined; current: boolean }) {
  const ms = job.milestones[index];
  const { data: trace, refetch, isFetching } = useJobTrace(Number(id), index, ms);
  const multi = job.milestones.length > 1;
  return (
    <details className={`${j.stage} ${STATUS_CLASS[ms.status]} ${current ? j.stageCurrent : ""}`} open={!multi && ms.status === PAID ? false : undefined}>
      <summary>
        <span className={j.stageName}>
          <strong>{multi ? `${index + 1}. ${ms.title || "Stage"}` : ms.title || "Payment"}</strong>
          <span className={`${styles.badge} ${STATUS_CLASS[ms.status]}`}>{STATUS_LABEL[ms.status]}</span>
        </span>
        <span className={j.stageAmount}>{formatAmount(job, amountFor(job, ms, me))}</span>
      </summary>
      <div className={j.stageBody}>
        <MilestoneDetails compact job={job} index={index} trace={trace} onRetry={() => refetch()} loading={isFetching} receiptHref={`#${receiptPath(Number(id), index)}`} />
        {!current && <JobActions id={id} index={index} job={job} />}
      </div>
    </details>
  );
}

/** One job in full: what it is worth to you, the one thing to do next, then its stages and the details. */
export function JobDetails({ id }: { id: string }) {
  const { address } = useAccount();
  const { data, isLoading, error: readError } = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getJob",
    args: [BigInt(id || 0)],
  });
  const raw = data as RawJob | undefined;
  const job: Job | undefined = raw && jobFromChain(raw);

  const me = address?.toLowerCase();
  const isPayer = job && me === job.payer.toLowerCase();
  const isPayee = job && me === job.payee.toLowerCase();
  const exists = !!job && job.milestones.length > 0;
  const { spec, ref } = parseDescription(job?.description ?? "");
  const hasSpec = !!spec || !!ref;
  const current = job ? currentMilestone(job) : 0;

  return (
    <section className={j.panel} aria-label={job ? jobTitle(job.description, id) : `Job #${id}`}>
      <div className={j.header}>
        <h2 className={styles.modalTitle}>{job ? jobTitle(job.description, id) : `Job #${id}`}</h2>
        <span className={styles.muted}>Job #{id}</span>
        {job && exists && <span className={`${styles.role} ${roleOf(job, me).className}`}>{roleOf(job, me).label}</span>}
      </div>
      {isLoading && <p>Loading…</p>}
      {readError && <p className={styles.error}>{readError.message.split("\n")[0]}</p>}
      {job && !exists && !isLoading && <p className={styles.muted}>This job doesn&apos;t exist.</p>}
      {job && exists && (
        <>
          <Money job={job} me={me} />
          {hasVerifier(job) && <VerifierLine id={id} job={job} isPayer={!!isPayer} />}
          <NextStep id={Number(id)} index={current} job={job} />

          {hasSpec && (
            <div className={j.spec}>
              <h3 className={styles.groupTitle}>About this job</h3>
              <SpecView description={job.description} />
            </div>
          )}

          <h3 className={styles.groupTitle}>{job.milestones.length > 1 ? "Stages" : "Payment"}</h3>
          <div className={j.stages}>
            {job.milestones.map((_, i) => (
              <Stage key={i} id={id} index={i} job={job} me={me} current={i === current && job.milestones[i].status !== PAID && job.milestones[i].status !== 5} />
            ))}
          </div>

          <details className={j.more}>
            <summary>Details</summary>
            <div className={j.moreInner}>
              <div className={styles.tiles}>
                <Party label="Payer" address={job.payer} you={!!isPayer} tone={styles.rolePayer} role="payer" />
                <Party label="Payee" address={job.payee} you={!!isPayee} tone={styles.rolePayee} role="payee" />
              </div>
              <p className={styles.muted}>
                Platform fee {formatAmount(job, job.fee)}, paid by the payee out of the payments
                {job.yield ? ". The payer pays no service fee: while the job is in escrow its money earns yield for Squirrel and comes back in full." : job.surchargeBps > 0 ? `, and a ${job.surchargeBps / 100}% service fee paid by the payer on top of each stage.` : "."}
              </p>
              <div>
                <button className={styles.ghostButton} onClick={() => navigate(`/flow/${id}`)}>
                  View payment flow
                </button>
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

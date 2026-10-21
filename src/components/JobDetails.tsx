import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useAccount, useReadContract } from "wagmi";
import { escrowAbi, escrowAddress } from "../wagmi";
import { formatAmount } from "../lib/tokens";
import { avatarGradient } from "../lib/avatar";
import { STATUS, STATUS_CLASS, STATUS_LABEL, addressUrl, formatDate, formatDuration, jobTotal, roleOf, short, timeInfo, type Job, type Milestone } from "../lib/jobs";
import { navigate } from "../hooks/useHashRoute";
import { DeliverableView, SpecView } from "./DocView";
import { JobActions } from "./JobActions";
import { jobTitle, parseDescription } from "../lib/documents";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import styles from "../App.module.css";

type RawJob = readonly [Omit<Job, "milestones">, readonly Milestone[]];

const TOTAL_LABEL: Record<string, string> = { "You pay": "You pay in total", "You earn": "You earn in total", Escrow: "Total in escrow" };

/** A person in the job: avatar, short address, and buttons to copy the address or open it in the block explorer. */
function Party({ label, address, you, tone }: { label: string; address: string; you: boolean; tone: string }) {
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
    </div>
  );
}

/** One job in full, as a card that floats over the page: its parties, spec and every milestone with the actions available to you. */
export function JobDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { address } = useAccount();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data, isLoading, error: readError } = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getJob",
    args: [BigInt(id || 0)],
  });
  const raw = data as RawJob | undefined;
  const job: Job | undefined = raw && { ...raw[0], milestones: [...raw[1]] };

  const { reviewPeriod } = useEscrowConfig();
  const now = useNow();

  const me = address?.toLowerCase();
  const isClient = job && me === job.client.toLowerCase();
  const isFreelancer = job && me === job.freelancer.toLowerCase();
  const exists = !!job && job.milestones.length > 0;
  const { spec, ref } = parseDescription(job?.description ?? "");
  const hasSpec = !!spec || !!ref;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <section className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={job ? jobTitle(job.description, id) : `Job #${id}`}>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{job ? jobTitle(job.description, id) : `Job #${id}`}</h2>
          <span className={styles.muted}>Job #{id}</span>
          {job && exists && <span className={`${styles.role} ${roleOf(job, me).className}`}>{roleOf(job, me).label}</span>}
        </div>
        {isLoading && <p>Loading…</p>}
        {readError && <p className={styles.error}>{readError.message.split("\n")[0]}</p>}
        {job && exists && (
          <>
            <div className={styles.tiles}>
              <Party label="Client" address={job.client} you={!!isClient} tone={styles.roleClient} />
              <Party label="Freelancer" address={job.freelancer} you={!!isFreelancer} tone={styles.roleFreelancer} />
              <div className={styles.tile}>
                <span className={styles.tileLabel}>{TOTAL_LABEL[roleOf(job, me).amountLabel]}</span>
                <strong className={styles.tileValue}>{formatAmount(job, jobTotal(job))}</strong>
                <span className={styles.segments} title={`${job.milestones.filter((m) => m.status === 4).length} of ${job.milestones.length} milestones paid`}>
                  {job.milestones.map((m, i) => (
                    <span key={i} className={`${styles.segment} ${STATUS_CLASS[m.status]}`} />
                  ))}
                </span>
                <span className={styles.muted}>
                  {job.milestones.filter((m) => m.status === 4).length} of {job.milestones.length} milestone{job.milestones.length > 1 ? "s" : ""} paid
                </span>
              </div>
            </div>

            {hasSpec && (
              <>
                <h3 className={styles.groupTitle}>About this job</h3>
                <SpecView description={job.description} />
              </>
            )}

            <h3 className={styles.groupTitle}>Milestones</h3>
            <div className={styles.milestones}>
              {job.milestones.map((ms, i) => {
                const hint = timeInfo(ms, reviewPeriod, now);
                return (
                  <div key={i} className={`${styles.milestone} ${STATUS_CLASS[ms.status]}`}>
                    <div className={styles.milestoneHead}>
                      <strong>
                        {i + 1}. {ms.title || "Milestone"}
                      </strong>
                      <span className={`${styles.badge} ${STATUS_CLASS[ms.status]}`}>{STATUS_LABEL[ms.status]}</span>
                    </div>
                    <span>{formatAmount(job, ms.amount)}</span>
                    <span className={styles.muted}>
                      {STATUS[ms.status] === "Unfunded"
                        ? `${formatDuration(BigInt(ms.duration))} to deliver once funded`
                        : STATUS[ms.status] === "Funded"
                          ? `Deadline ${formatDate(ms.deadline)}`
                          : ms.submittedAt > 0n
                            ? `Submitted ${formatDate(ms.submittedAt)}`
                            : ""}
                      {hint && STATUS[ms.status] !== "Unfunded" ? ` · ${hint}` : ""}
                    </span>
                    {ms.deliverable && (
                      <div className={styles.deliverableRow}>
                        <span className={styles.muted}>Deliverable</span>
                        <DeliverableView value={ms.deliverable} />
                      </div>
                    )}
                    <JobActions id={id} index={i} job={job} />
                  </div>
                );
              })}
            </div>

            <button
              className={styles.ghostButton}
              onClick={() => navigate(`/flow/${id}`)}
            >
              View payment flow
            </button>
          </>
        )}
      </section>
    </div>
  );
}

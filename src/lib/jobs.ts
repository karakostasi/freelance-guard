import styles from "../App.module.css";
import { formatDuration } from "./format";
import { milestoneFeeShare, surchargeOn } from "./fees";

export { formatDuration };

export type Milestone = {
  title: string;
  amount: bigint;
  /** Seconds the payee has once the milestone is funded. */
  duration: number;
  deadline: bigint;
  submittedAt: bigint;
  status: number;
  deliverable: string;
  /** 0 when the money is idle in the escrow, otherwise the vault epoch it went into. */
  epoch: number;
};

export type Job = {
  payer: string;
  payee: string;
  /** Zero address means ETH. */
  token: string;
  description: string;
  milestones: Milestone[];
  /** What the payee pays for the whole job, shared between the milestones by amount. Fixed when the job was created. */
  fee: bigint;
  /** What the payer pays on top of each milestone when funding it, in basis points. Zero when the job takes the yield. */
  surchargeBps: number;
  /** May approve submitted milestones for the payer. The zero address when there is none. */
  verifier: string;
  /** The job's money sits in the token's vault while in escrow. */
  yield: boolean;
};

/** The tuple `getJob` returns. */
export type RawJob = readonly [
  { payer: string; payee: string; token: string; description: string; total: bigint; fee: bigint; surchargeBps: number; verifier: string; yield: boolean },
  readonly Milestone[],
];

export const jobFromChain = ([head, milestones]: RawJob): Job => ({
  payer: head.payer,
  payee: head.payee,
  token: head.token,
  description: head.description,
  fee: head.fee,
  surchargeBps: Number(head.surchargeBps),
  verifier: head.verifier,
  yield: head.yield,
  milestones: milestones.map((m) => ({ ...m, epoch: Number(m.epoch) })),
});

const NO_ONE = "0x0000000000000000000000000000000000000000";

export const hasVerifier = (job: Job) => job.verifier !== NO_ONE;

/** The payee's share of the job fee for one milestone, taken from its payment. Rounds down, like the contract. */
export const milestoneFee = (job: Job, ms: Milestone) => milestoneFeeShare(job.fee, ms.amount, jobTotal(job));

/** What the payer pays on top of a milestone when funding it. */
export const milestoneSurcharge = (job: Job, ms: Milestone) => surchargeOn(ms.amount, job.surchargeBps);

export const STATUS = ["Unfunded", "Funded", "Submitted", "Disputed", "Paid", "Refunded"];

/** Human-friendly labels, indexed like STATUS: "Delivered" is work the payee has submitted, "Paid" what was released. STATUS itself stays the contract's enum names. */
export const STATUS_LABEL = ["Not funded", "In progress", "Delivered", "Disputed", "Paid", "Refunded"];

export const STATUS_CLASS = [styles.unfunded, styles.funded, styles.submitted, styles.disputed, styles.paid, styles.refunded];

const PAID = 4;
const REFUNDED = 5;
export const isDone = (m: Milestone) => m.status === PAID || m.status === REFUNDED;

export const jobTotal = (job: Job) => job.milestones.reduce((sum, m) => sum + m.amount, 0n);

/** The milestone that needs attention next: the first one not yet paid or refunded. */
export const currentMilestone = (job: Job) => {
  const index = job.milestones.findIndex((m) => !isDone(m));
  return index === -1 ? job.milestones.length - 1 : index;
};

/**
 * What to call a milestone in button text, e.g. "draft" for a milestone titled "Draft".
 * Empty for a single-payment job, so its buttons keep the generic wording ("Submit work").
 */
export function milestoneName(job: Job, index: number) {
  if (job.milestones.length < 2) return "";
  const title = job.milestones[index].title.trim().toLowerCase();
  if (!title) return `milestone ${index + 1}`;
  return title.length > 22 ? `${title.slice(0, 21)}…` : title;
}

/** Where a job stands as a whole: its current milestone, how many are paid, and a label and color for it. */
export function jobSummary(job: Job) {
  const current = job.milestones[currentMilestone(job)];
  const finished = job.milestones.every(isDone);
  const paid = job.milestones.filter((m) => m.status === PAID).length;
  const allPaid = paid === job.milestones.length;
  return {
    current,
    finished,
    paid,
    label: finished ? (allPaid ? "Completed" : "Closed") : STATUS_LABEL[current.status],
    tone: STATUS_CLASS[finished ? (allPaid ? PAID : REFUNDED) : current.status],
  };
}

export type Role = { label: string; className: string; amountLabel: string };

/** Which side of the job `me` is on. Anyone who is neither a party nor the verifier is the arbiter. */
export function roleOf(job: Job, me: string | undefined): Role {
  const addr = me?.toLowerCase();
  if (addr === job.payer.toLowerCase()) return { label: "Payer", className: styles.rolePayer, amountLabel: "You pay" };
  if (addr === job.payee.toLowerCase()) return { label: "Payee", className: styles.rolePayee, amountLabel: "You earn" };
  if (addr && hasVerifier(job) && addr === job.verifier.toLowerCase()) return { label: "Verifier", className: styles.roleArbiter, amountLabel: "Escrow" };
  return { label: "Arbiter", className: styles.roleArbiter, amountLabel: "Escrow" };
}

/** How a paid milestone was released, in words. `releaser` is the lowercase address that sent the release transaction, when known. */
export function paidOutcome(job: Job, kind: "Approved" | "Resolved" | undefined, releaser: string | undefined) {
  if (kind === "Resolved") return "Resolved by the arbiter in favour of the payee";
  if (releaser === job.payee.toLowerCase()) return "Claimed by the payee after the review period";
  if (releaser && hasVerifier(job) && releaser === job.verifier.toLowerCase()) return "Approved by the verifier";
  if (releaser === job.payer.toLowerCase()) return "Approved by the payer";
  return "Paid to the payee";
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const formatDate = (unix: bigint) => new Date(Number(unix) * 1000).toLocaleString();

/** A day without the time, for deadlines in a sentence: "3 Nov". */
export const formatDay = (unix: bigint) => new Date(Number(unix) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * What a milestone is worth to `me`: the payee gets it less their share of the platform fee, everyone else sees
 * the full amount.
 */
export const amountFor = (job: Job, ms: Milestone, me: string | undefined) => (me && me.toLowerCase() === job.payee.toLowerCase() ? ms.amount - milestoneFee(job, ms) : ms.amount);

/** One-line timing hint for a milestone, or "" when nothing is time-sensitive. */
export function timeInfo(m: Milestone, reviewPeriod: bigint | undefined, now: bigint) {
  const status = STATUS[m.status];
  if (status === "Unfunded") return "Waiting for funding";
  if (status === "Funded") {
    return now > m.deadline ? "Delivery overdue" : `Due in ${formatDuration(m.deadline - now)}`;
  }
  if (status === "Submitted" && reviewPeriod !== undefined) {
    const end = m.submittedAt + reviewPeriod;
    return now >= end ? "Review period ended" : `Review ends in ${formatDuration(end - now)}`;
  }
  return "";
}

export { deliverableUrl } from "./documents";

/** The network the escrow runs on, as printed on receipts. Keep in step with the explorer links below. */
export const NETWORK_LABEL = "Base Sepolia (test network)";

export const txUrl = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
export const addressUrl = (address: string) => `https://sepolia.basescan.org/address/${address}`;

export const euro = (n: number) => `€${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

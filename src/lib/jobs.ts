import styles from "../App.module.css";
import { formatDuration } from "./format";

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
};

export type Job = {
  payer: string;
  payee: string;
  /** Zero address means ETH. */
  token: string;
  description: string;
  milestones: Milestone[];
};

/**
 * The tuple `getJob` returns. The contract still calls the two parties `client` and `freelancer`;
 * `jobFromChain` is the one place those names are translated to the app's `payer` and `payee`.
 */
export type RawJob = readonly [{ client: string; freelancer: string; token: string; description: string }, readonly Milestone[]];

export const jobFromChain = ([head, milestones]: RawJob): Job => ({
  payer: head.client,
  payee: head.freelancer,
  token: head.token,
  description: head.description,
  milestones: [...milestones],
});

export const STATUS = ["Unfunded", "Funded", "Submitted", "Disputed", "Paid", "Refunded"];

/** Human-friendly labels, indexed like STATUS. STATUS itself stays the contract's enum names. */
export const STATUS_LABEL = ["Not funded", "In progress", "Submitted", "Disputed", "Delivered", "Refunded"];

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

/** Which side of the job `me` is on. Anyone who is neither party is the arbiter. */
export function roleOf(job: Job, me: string | undefined): Role {
  const addr = me?.toLowerCase();
  if (addr === job.payer.toLowerCase()) return { label: "Payer", className: styles.rolePayer, amountLabel: "You pay" };
  if (addr === job.payee.toLowerCase()) return { label: "Payee", className: styles.rolePayee, amountLabel: "You earn" };
  return { label: "Arbiter", className: styles.roleArbiter, amountLabel: "Escrow" };
}

/** How a paid milestone was released, in words. `releaser` is the lowercase address that sent the release transaction, when known. */
export function paidOutcome(job: Job, kind: "Approved" | "Resolved" | undefined, releaser: string | undefined) {
  if (kind === "Resolved") return "Resolved by the arbiter in favour of the payee";
  if (releaser === job.payee.toLowerCase()) return "Claimed by the payee after the review period";
  if (releaser === job.payer.toLowerCase()) return "Approved by the payer";
  return "Paid to the payee";
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const formatDate = (unix: bigint) => new Date(Number(unix) * 1000).toLocaleString();

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

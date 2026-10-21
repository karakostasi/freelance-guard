import styles from "../App.module.css";

export type Milestone = {
  title: string;
  amount: bigint;
  /** Seconds the freelancer has once the milestone is funded. */
  duration: number;
  deadline: bigint;
  submittedAt: bigint;
  status: number;
  deliverable: string;
};

export type Job = {
  client: string;
  freelancer: string;
  /** Zero address means ETH. */
  token: string;
  description: string;
  milestones: Milestone[];
};

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
  if (addr === job.client.toLowerCase()) return { label: "Client", className: styles.roleClient, amountLabel: "You pay" };
  if (addr === job.freelancer.toLowerCase()) return { label: "Freelancer", className: styles.roleFreelancer, amountLabel: "You earn" };
  return { label: "Arbiter", className: styles.roleArbiter, amountLabel: "Escrow" };
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const formatDuration = (seconds: bigint) => {
  const s = Number(seconds > 0n ? seconds : 0n);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

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

export const txUrl = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
export const addressUrl = (address: string) => `https://sepolia.basescan.org/address/${address}`;

export const euro = (n: number) => `€${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

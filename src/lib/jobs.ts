import styles from "../App.module.css";

export type Job = readonly [string, string, bigint, bigint, bigint, number, string, string];

export const STATUS = ["None", "Funded", "Submitted", "Disputed", "Paid", "Refunded"];

export const STATUS_CLASS = ["", styles.funded, styles.submitted, styles.disputed, styles.paid, styles.refunded];

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

/** One-line timing hint for a job card, or "" when nothing is time-sensitive. */
export function timeInfo(job: Job, reviewPeriod: bigint | undefined, now: bigint) {
  const status = STATUS[job[5]];
  if (status === "Funded") {
    return now > job[3] ? "Delivery overdue" : `Due in ${formatDuration(job[3] - now)}`;
  }
  if (status === "Submitted" && reviewPeriod !== undefined) {
    const end = job[4] + reviewPeriod;
    return now >= end ? "Review period ended" : `Review ends in ${formatDuration(end - now)}`;
  }
  return "";
}

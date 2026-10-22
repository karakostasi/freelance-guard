import { formatDuration } from "./format.ts";
import type { Job } from "./jobs";

const FUNDED = 1;
const SUBMITTED = 2;
const PAID = 4;
const REFUNDED = 5;
const DAY = 86400n;

export type Reminder = {
  text: string;
  /** "info" is just a countdown, "warn" is under a day left, "action" means you can act now. */
  tone: "info" | "warn" | "action";
  milestone: number;
};

/**
 * The most pressing thing about a job for `me`, or undefined when there is nothing time-related to say.
 * It looks at the first milestone that isn't finished, like the rest of the app.
 */
export function reminderFor(job: Job, me: string | undefined, reviewPeriod: bigint | undefined, now: bigint): Reminder | undefined {
  const addr = me?.toLowerCase();
  const isClient = addr === job.client.toLowerCase();
  const isFreelancer = addr === job.freelancer.toLowerCase();
  if (!isClient && !isFreelancer) return undefined;

  const milestone = job.milestones.findIndex((m) => m.status !== PAID && m.status !== REFUNDED);
  if (milestone === -1) return undefined;
  const m = job.milestones[milestone];
  const soon = (to: bigint): Reminder["tone"] => (to - now < DAY ? "warn" : "info");
  const result = (text: string, tone: Reminder["tone"]): Reminder => ({ text, tone, milestone });

  if (m.status === FUNDED) {
    if (now > m.deadline) return result(isClient ? "Deadline passed. You can take a refund" : "Deadline passed. The client can take a refund", isClient ? "action" : "warn");
    return result(isFreelancer ? `Deliver in ${formatDuration(m.deadline - now)}` : `Delivery due in ${formatDuration(m.deadline - now)}`, soon(m.deadline));
  }
  if (m.status === SUBMITTED && reviewPeriod !== undefined) {
    const end = m.submittedAt + reviewPeriod;
    if (now >= end) return isFreelancer ? result("Review period ended. Claim your payment", "action") : result("Review period ended. The freelancer can claim payment", "warn");
    return isClient ? result(`Review ends in ${formatDuration(end - now)}. Approve or dispute`, soon(end)) : result(`Client review ends in ${formatDuration(end - now)}`, "info");
  }
  return undefined;
}

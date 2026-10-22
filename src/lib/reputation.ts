import type { Job } from "./jobs";

const PAID = 4;
const REFUNDED = 5;
const DISPUTED = 3;

/** How many finished milestones an account needs before we call its record anything but "New". */
export const MIN_HISTORY = 3;

export type Tier = "new" | "good" | "mixed" | "risky";

export type SideRecord = {
  /** Jobs the account is part of in this role. */
  jobs: number;
  /** Milestones that ended in a payment to the freelancer. */
  paid: number;
  /** Milestones where the client contested the work. */
  disputes: number;
  /** Disputes the client lost (the freelancer was paid anyway), or, for a freelancer, disputes lost to the client. */
  disputesLost: number;
  /** Funded milestones the freelancer never delivered by the deadline. Always 0 for a client. */
  missed: number;
  /** Milestones that count towards the tier: how it ended is known. */
  finished: number;
  /** Milestones that went wrong for this account. */
  bad: number;
  tier: Tier;
};

export type Reputation = { asClient: SideRecord; asFreelancer: SideRecord };

export const jobKey = (id: number, milestone: number) => `${id}:${milestone}`;

const tierOf = (finished: number, bad: number): Tier => {
  if (finished < MIN_HISTORY) return "new";
  const rate = bad / finished;
  return rate <= 0.1 ? "good" : rate <= 0.3 ? "mixed" : "risky";
};

/**
 * An account's record as client and as freelancer, from the milestones on the contract.
 *
 * `disputed` holds the "id:milestone" of every milestone that was ever disputed (from the Disputed events).
 * A dispute that was already resolved leaves no trace in the milestone itself, except that a refund after
 * delivery can only come from the arbiter. Without the events, those that ended in a payment are missed.
 */
export function computeReputation(jobs: { id: number; job: Job }[], address: string, disputed: ReadonlySet<string>): Reputation {
  const me = address.toLowerCase();
  const client = { jobs: 0, paid: 0, disputes: 0, disputesLost: 0, missed: 0, finished: 0, bad: 0 };
  const freelancer = { ...client };

  for (const { id, job } of jobs) {
    const isClient = job.client.toLowerCase() === me;
    const isFreelancer = job.freelancer.toLowerCase() === me;
    if (!isClient && !isFreelancer) continue;
    const side = isClient ? client : freelancer;
    side.jobs++;

    job.milestones.forEach((m, i) => {
      const delivered = m.submittedAt > 0n;
      const wasDisputed = disputed.has(jobKey(id, i)) || m.status === DISPUTED || (m.status === REFUNDED && delivered);
      const missed = m.status === REFUNDED && !delivered;
      const lostByClient = wasDisputed && m.status === PAID;
      const lostByFreelancer = wasDisputed && m.status === REFUNDED;

      if (m.status === PAID) side.paid++;
      if (wasDisputed) side.disputes++;
      if (isClient) {
        if (lostByClient) side.disputesLost++;
        // A refund for a missed deadline says nothing about how the client pays.
        if (m.status === PAID || lostByFreelancer) side.finished++;
        if (lostByClient) side.bad++;
      } else {
        if (lostByFreelancer) side.disputesLost++;
        if (missed) side.missed++;
        if (m.status === PAID || lostByFreelancer || missed) side.finished++;
        if (lostByFreelancer || missed) side.bad++;
      }
    });
  }

  return {
    asClient: { ...client, tier: tierOf(client.finished, client.bad) },
    asFreelancer: { ...freelancer, tier: tierOf(freelancer.finished, freelancer.bad) },
  };
}

export const TIER_LABEL: Record<Tier, string> = { new: "New", good: "Reliable", mixed: "Mixed record", risky: "Risky" };

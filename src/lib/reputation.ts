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
  /** Milestones that ended in a payment to the payee. */
  paid: number;
  /** Milestones where the payer contested the work. */
  disputes: number;
  /** Disputes the payer lost (the payee was paid anyway), or, for a payee, disputes lost to the payer. */
  disputesLost: number;
  /** Funded milestones the payee never delivered by the deadline. Always 0 for a payer. */
  missed: number;
  /** Milestones that count towards the tier: how it ended is known. */
  finished: number;
  /** Milestones that went wrong for this account. */
  bad: number;
  tier: Tier;
};

export type Reputation = { asPayer: SideRecord; asPayee: SideRecord };

export const jobKey = (id: number, milestone: number) => `${id}:${milestone}`;

const tierOf = (finished: number, bad: number): Tier => {
  if (finished < MIN_HISTORY) return "new";
  const rate = bad / finished;
  return rate <= 0.1 ? "good" : rate <= 0.3 ? "mixed" : "risky";
};

/**
 * An account's record as payer and as payee, from the milestones on the contract.
 *
 * `disputed` holds the "id:milestone" of every milestone that was ever disputed (from the Disputed events).
 * A dispute that was already resolved leaves no trace in the milestone itself, except that a refund after
 * delivery can only come from the arbiter. Without the events, those that ended in a payment are missed.
 */
export function computeReputation(jobs: { id: number; job: Job }[], address: string, disputed: ReadonlySet<string>): Reputation {
  const me = address.toLowerCase();
  const payer = { jobs: 0, paid: 0, disputes: 0, disputesLost: 0, missed: 0, finished: 0, bad: 0 };
  const payee = { ...payer };

  for (const { id, job } of jobs) {
    const isPayer = job.payer.toLowerCase() === me;
    const isPayee = job.payee.toLowerCase() === me;
    if (!isPayer && !isPayee) continue;
    const side = isPayer ? payer : payee;
    side.jobs++;

    job.milestones.forEach((m, i) => {
      const delivered = m.submittedAt > 0n;
      const wasDisputed = disputed.has(jobKey(id, i)) || m.status === DISPUTED || (m.status === REFUNDED && delivered);
      const missed = m.status === REFUNDED && !delivered;
      const lostByPayer = wasDisputed && m.status === PAID;
      const lostByPayee = wasDisputed && m.status === REFUNDED;

      if (m.status === PAID) side.paid++;
      if (wasDisputed) side.disputes++;
      if (isPayer) {
        if (lostByPayer) side.disputesLost++;
        // A refund for a missed deadline says nothing about how the payer pays.
        if (m.status === PAID || lostByPayee) side.finished++;
        if (lostByPayer) side.bad++;
      } else {
        if (lostByPayee) side.disputesLost++;
        if (missed) side.missed++;
        if (m.status === PAID || lostByPayee || missed) side.finished++;
        if (lostByPayee || missed) side.bad++;
      }
    });
  }

  return {
    asPayer: { ...payer, tier: tierOf(payer.finished, payer.bad) },
    asPayee: { ...payee, tier: tierOf(payee.finished, payee.bad) },
  };
}

export const TIER_LABEL: Record<Tier, string> = { new: "New", good: "Reliable", mixed: "Mixed record", risky: "Risky" };

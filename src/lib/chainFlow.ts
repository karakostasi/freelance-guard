import { escrowAddress } from "../wagmi";
import type { JobTrace } from "../hooks/useJobTrace";
import { STATUS, type Job } from "./jobs";
import {
  FUNDING_STAGES,
  RELEASE_STAGE,
  WORK_STAGE_INDEX,
  initialFlowState,
  journeyStages,
  stepKey,
  type FlowContext,
  type FlowState,
  type PayoutRoute,
  type Stage,
} from "./fiatFlow";

type Payload = Record<string, unknown>;

/** Payloads for every sub-step as the simulation would produce them. Call once per job and memoize. */
export function simulatedPayloads(stages: Stage[], ctx: FlowContext) {
  const out: Record<string, Payload> = {};
  stages.forEach((s, si) => s.steps.forEach((step, i) => (out[stepKey(si, i)] = { simulated: true, ...step.payload(ctx) })));
  return out;
}

const txPayload = (id: number, tx: NonNullable<JobTrace["created"]>, extra: Payload = {}): Payload => ({
  chain: "Base Sepolia (84532)",
  contract: escrowAddress,
  jobId: id,
  txHash: tx.txHash,
  blockNumber: Number(tx.blockNumber),
  gasUsed: Number(tx.gasUsed),
  blockTime: new Date(tx.blockTime * 1000).toISOString(),
  ...extra,
});

/** Funding flow for an existing job: off-chain stages as simulated, escrow stages from real chain data. */
export function deriveFunding(id: number, job: Job, trace: JobTrace | undefined, sim: Record<string, Payload>): FlowState {
  if (STATUS[job[5]] === "None") return initialFlowState;
  const done: FlowState["done"] = {};
  const at = trace?.created ? trace.created.blockTime * 1000 : 0;
  FUNDING_STAGES.forEach((s, si) => s.steps.forEach((_, i) => (done[stepKey(si, i)] = { at, payload: sim[stepKey(si, i)] })));

  done[stepKey(2, 1)].payload = {
    signer: job[0],
    note: "Gas is paid by the signing wallet on this testnet. A production paymaster would sponsor it.",
  };
  done[stepKey(2, 2)].payload = trace?.created
    ? txPayload(id, trace.created, { function: "createJob (depositMilestone)", amountWei: job[2].toString() })
    : { contract: escrowAddress, jobId: id, note: "Transaction not found. Set VITE_ESCROW_DEPLOY_BLOCK to the contract's deploy block." };
  done[stepKey(3, 0)].payload = { contract: escrowAddress, jobId: id, status: STATUS[job[5]].toUpperCase() };

  return { status: "done", done, startedAt: at, finishedAt: at };
}

/** The real "Release" stage of the payout flow, available once the job is paid. */
export function deriveRelease(id: number, job: Job, trace: JobTrace | undefined): FlowState["done"] {
  if (STATUS[job[5]] !== "Paid") return {};
  const at = trace?.released ? trace.released.blockTime * 1000 : 0;
  const kind = trace?.released?.kind;
  return {
    [stepKey(RELEASE_STAGE, 0)]: {
      at,
      payload: { jobId: id, event: kind ?? "unknown", paidTo: job[1], decidedBy: kind === "Resolved" ? "arbiter" : "client approval or review timeout" },
    },
    [stepKey(RELEASE_STAGE, 1)]: {
      at,
      payload: trace?.released
        ? txPayload(id, trace.released, { function: kind === "Resolved" ? "resolve" : "approve / claimAfterTimeout", amountWei: job[2].toString() })
        : { contract: escrowAddress, jobId: id, note: "Transaction not found. Set VITE_ESCROW_DEPLOY_BLOCK to the contract's deploy block." },
    },
  };
}

/** The real "Work & Review" stage: submitted once the freelancer delivers, reviewed once the job is paid. */
export function deriveWork(id: number, job: Job, trace: JobTrace | undefined): FlowState["done"] {
  const done: FlowState["done"] = {};
  if (job[4] > 0n) {
    const at = trace?.submitted ? trace.submitted.blockTime * 1000 : Number(job[4]) * 1000;
    done[stepKey(WORK_STAGE_INDEX, 0)] = {
      at,
      payload: trace?.submitted
        ? txPayload(id, trace.submitted, { function: "submitWork", deliverable: job[7] })
        : { contract: escrowAddress, jobId: id, deliverable: job[7], submittedAt: new Date(Number(job[4]) * 1000).toISOString() },
    };
  }
  if (STATUS[job[5]] === "Paid") {
    const kind = trace?.released?.kind;
    done[stepKey(WORK_STAGE_INDEX, 1)] = {
      at: trace?.released ? trace.released.blockTime * 1000 : 0,
      payload: { jobId: id, outcome: kind === "Resolved" ? "resolved by arbiter" : "approved by client or review timeout" },
    };
  }
  return done;
}

/**
 * Whole job as one journey: funding, work and payout. Everything comes from chain data except the
 * simulated off-chain steps and the routing run, which is passed in as `payout`.
 */
export function deriveJourney(
  id: number,
  job: Job,
  trace: JobTrace | undefined,
  sim: Record<string, Payload>,
  payout: FlowState,
  route: PayoutRoute,
): FlowState {
  const stages = journeyStages(route);
  const done: FlowState["done"] = {
    ...deriveFunding(id, job, trace, sim).done,
    ...deriveWork(id, job, trace),
    ...deriveRelease(id, job, trace),
    ...payout.done,
  };
  const timing = { startedAt: payout.startedAt, finishedAt: payout.finishedAt };
  if (payout.status === "running") return { status: "running", done, current: payout.current, ...timing };

  const refunded = STATUS[job[5]] === "Refunded";
  let current: FlowState["current"];
  if (!refunded) {
    outer: for (let si = 0; si < stages.length; si++) {
      for (let i = 0; i < stages[si].steps.length; i++) {
        if (!done[stepKey(si, i)]) {
          current = { stage: si, step: i };
          break outer;
        }
      }
    }
  }
  return { status: current ? "running" : "done", done, current, waiting: !!current, ...timing };
}

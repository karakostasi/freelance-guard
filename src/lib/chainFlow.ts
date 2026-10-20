import { escrowAddress } from "../wagmi";
import type { JobTrace } from "../hooks/useJobTrace";
import { STATUS, type Job } from "./jobs";
import { FUNDING_STAGES, initialFlowState, stepKey, type FlowContext, type FlowState, type Stage } from "./fiatFlow";

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
    [stepKey(0, 0)]: {
      at,
      payload: { jobId: id, event: kind ?? "unknown", paidTo: job[1], decidedBy: kind === "Resolved" ? "arbiter" : "client approval or review timeout" },
    },
    [stepKey(0, 1)]: {
      at,
      payload: trace?.released
        ? txPayload(id, trace.released, { function: kind === "Resolved" ? "resolve" : "approve / claimAfterTimeout", amountWei: job[2].toString() })
        : { contract: escrowAddress, jobId: id, note: "Transaction not found. Set VITE_ESCROW_DEPLOY_BLOCK to the contract's deploy block." },
    },
  };
}

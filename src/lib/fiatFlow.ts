import { escrowAddress } from "../wagmi";

// The bank, AML, FX and token-mint steps are simulated: there is no real bank, AML provider or
// EURC issuer behind them. The escrow steps (wallet signature, deposit, release) are real
// transactions on the escrow contract and are filled in from chain data (see chainFlow.ts).

/** Demo exchange rate used to show EUR next to ETH amounts. */
export const EUR_PER_ETH = 2500;

export type FlowKind = "funding" | "payout";
export type PayoutRoute = "eurc" | "sepa";

export type SubStep = {
  id: string;
  label: string;
  /** Plain-language text for "Simple Business Mode". */
  simple: string;
  durationMs: number;
  /** True when the step is backed by the real escrow contract rather than simulated. */
  real?: boolean;
  /** Raw data shown in "Auditor / Dev Mode". */
  payload: (ctx: FlowContext) => Record<string, unknown>;
};

export type Stage = {
  id: string;
  /** Phase of the journey this stage belongs to, shown above the stage boxes. */
  group: "Fund" | "Work" | "Payout";
  title: string;
  /** Lucide icon name, resolved in the UI. */
  icon: "landmark" | "coins" | "shield" | "check" | "route" | "send";
  /** Shown in Simple mode when the stage completes. */
  assurance: string;
  steps: SubStep[];
};

export type FlowContext = { jobId: string; amountEur: number; route?: PayoutRoute };

const hex = (bytes: number) =>
  "0x" + Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

const iso = () => new Date().toISOString();
const eur = (n: number) => n.toFixed(2);

export const FUNDING_STAGES: Stage[] = [
  {
    id: "inbound",
    group: "Fund",
    title: "Fiat Inbound",
    icon: "landmark",
    assurance: "Your payment was received and verified.",
    steps: [
      {
        id: "webhook",
        label: "Bank webhook verified",
        simple: "Bank confirmed your SEPA Instant transfer",
        durationMs: 900,
        payload: (c) => ({ event: "sepa_instant.credited", amount: eur(c.amountEur), currency: "EUR", signature: hex(32), receivedAt: iso() }),
      },
      {
        id: "aml",
        label: "AML & sanctions check",
        simple: "Compliance screening passed",
        durationMs: 1300,
        payload: () => ({ provider: "mock-aml", sanctionsHit: false, riskScore: 0.04, result: "PASS" }),
      },
      {
        id: "ledger",
        label: "Internal ledger allocation",
        simple: "Funds reserved for this job",
        durationMs: 800,
        payload: (c) => ({ ledgerEntry: hex(16), account: `milestone:${c.jobId}`, debit: "client_vIBAN", credit: "escrow_pending", amountEur: eur(c.amountEur) }),
      },
    ],
  },
  {
    id: "tokenization",
    group: "Fund",
    title: "Tokenization",
    icon: "coins",
    assurance: "Euros are backed 1:1 by reserves.",
    steps: [
      {
        id: "fx",
        label: "FX rate locked (15 min)",
        simple: "Exchange rate fixed so the amount can't move",
        durationMs: 800,
        payload: () => ({ pair: "EUR/EURC", rate: "1.0000", lockedUntil: new Date(Date.now() + 15 * 60_000).toISOString() }),
      },
      {
        id: "por",
        label: "Proof-of-Reserves check",
        simple: "Reserves verified against issued tokens",
        durationMs: 1200,
        payload: () => ({ reservesEur: "12480331.20", issuedEurc: "12480331.20", ratio: "1.000", attestation: hex(32) }),
      },
      {
        id: "mint",
        label: "EURC mint",
        simple: "Digital euros created for this payment",
        durationMs: 1100,
        payload: (c) => ({ token: "EURC", amount: eur(c.amountEur), mintTx: hex(32), network: "base-sepolia" }),
      },
    ],
  },
  {
    id: "escrow",
    group: "Fund",
    title: "Escrow Deposit",
    icon: "shield",
    assurance: "Funds are locked in a tamper-proof escrow contract.",
    steps: [
      {
        id: "userop",
        label: "UserOperation built (ERC-4337)",
        simple: "Deposit instruction prepared",
        durationMs: 800,
        payload: (c) => ({ sender: hex(20), callData: "depositMilestone(uint256,uint256)", args: [c.jobId, eur(c.amountEur)], nonce: Math.floor(Math.random() * 1000) }),
      },
      {
        id: "signature",
        real: true,
        label: "Deposit signed in wallet",
        simple: "You approve the deposit in your wallet",
        durationMs: 900,
        payload: () => ({ note: "Filled in from the real wallet signature" }),
      },
      {
        id: "deposit",
        real: true,
        label: "Deposit confirmed on-chain",
        simple: "Deposit recorded on the blockchain",
        durationMs: 1500,
        payload: () => ({ note: "Filled in from the real transaction receipt" }),
      },
    ],
  },
  {
    id: "activated",
    group: "Fund",
    title: "Job Activated",
    icon: "check",
    assurance: "Funds secured in tamper-proof escrow.",
    steps: [
      {
        id: "funded",
        real: true,
        label: "Escrow state → FUNDED",
        simple: "Job is funded and locked",
        durationMs: 700,
        payload: (c) => ({ contract: escrowAddress, jobId: c.jobId, status: "FUNDED" }),
      },
      {
        id: "notify",
        label: "Freelancer notified (webhook)",
        simple: "Freelancer told they can start",
        durationMs: 700,
        payload: (c) => ({ webhook: "milestone.funded", delivered: true, jobId: c.jobId, at: iso() }),
      },
      {
        id: "dashboard",
        label: "Invoice dashboard updated",
        simple: "Your invoice now shows as funded",
        durationMs: 600,
        payload: (c) => ({ invoice: `INV-${c.jobId}`, status: "FUNDED", updatedAt: iso() }),
      },
    ],
  },
];

export const WORK_STAGE: Stage = {
  id: "work",
  group: "Work",
  title: "Work & Review",
  icon: "check",
  assurance: "The work was reviewed and accepted.",
  steps: [
    {
      id: "submitted",
      real: true,
      label: "Work submitted",
      simple: "Freelancer delivered the work",
      durationMs: 0,
      payload: () => ({ note: "Filled in from the real escrow state" }),
    },
    {
      id: "review",
      real: true,
      label: "Client review",
      simple: "Client reviews and accepts the work",
      durationMs: 0,
      payload: () => ({ note: "Filled in from the real escrow state" }),
    },
  ],
};

export const payoutStages = (route: PayoutRoute): Stage[] => [
  {
    id: "release",
    group: "Payout",
    title: "Release",
    icon: "shield",
    assurance: "Approved by the client, released automatically.",
    steps: [
      {
        id: "approval",
        real: true,
        label: "Client approval verified",
        simple: "The delivered work was accepted",
        durationMs: 800,
        payload: () => ({ note: "Filled in from the real escrow state" }),
      },
      {
        id: "release",
        real: true,
        label: "Release confirmed on-chain",
        simple: "Escrow released the funds",
        durationMs: 1500,
        payload: () => ({ note: "Filled in from the real transaction receipt" }),
      },
    ],
  },
  {
    id: "routing",
    group: "Payout",
    title: "Payout Routing",
    icon: "route",
    assurance: route === "eurc" ? "You keep the digital euros." : "Converted to euros automatically.",
    steps: [
      {
        id: "route",
        label: route === "eurc" ? "Route: keep EURC" : "Route: off-ramp to SEPA",
        simple: route === "eurc" ? "Payment stays as digital euros" : "Payment will be sent to the bank account",
        durationMs: 800,
        payload: (c) => ({ route: c.route, fee: route === "eurc" ? "0.00" : "0.15" }),
      },
      {
        id: "convert",
        label: route === "eurc" ? "Wallet credited" : "EURC redeemed to EUR",
        simple: route === "eurc" ? "Digital euros added to your wallet" : "Digital euros converted to euros",
        durationMs: 1100,
        payload: (c) => ({ amount: eur(c.amountEur), token: "EURC", burnOrTransferTx: hex(32) }),
      },
    ],
  },
  {
    id: "settlement",
    group: "Payout",
    title: "Settlement",
    icon: "send",
    assurance: route === "eurc" ? "Funds are in your wallet." : "Funds are on their way to your bank.",
    steps: [
      {
        id: "settle",
        label: route === "eurc" ? "EURC available" : "SEPA Instant sent",
        simple: route === "eurc" ? "Funds available in your wallet" : "Transfer sent, arrives within seconds",
        durationMs: 1000,
        payload: (c) => ({ rail: route === "eurc" ? "base-sepolia" : "sepa_instant", amount: eur(c.amountEur), reference: `FG-${c.jobId}-${hex(3).slice(2)}` }),
      },
      {
        id: "receipt",
        label: "Receipt issued",
        simple: "Receipt saved to the invoice",
        durationMs: 600,
        payload: (c) => ({ invoice: `INV-${c.jobId}`, status: "PAID_OUT", at: iso() }),
      },
    ],
  },
];

// --- run state, driven by events from the mock emitter ---------------------

export type FlowEvent =
  | { type: "start"; at: number }
  | { type: "error"; message: string }
  | { type: "step_start"; stage: number; step: number; at: number }
  | { type: "step_done"; stage: number; step: number; at: number; payload: Record<string, unknown> }
  | { type: "done"; at: number }
  | { type: "reset" };

export type FlowState = {
  status: "idle" | "running" | "done" | "error";
  error?: string;
  /** Set on chain-derived state: the current step is waiting on a person, not running. */
  waiting?: boolean;
  startedAt?: number;
  finishedAt?: number;
  current?: { stage: number; step: number };
  done: Record<string, { at: number; payload: Record<string, unknown> }>;
};

export const initialFlowState: FlowState = { status: "idle", done: {} };

export const stepKey = (stage: number, step: number) => `${stage}.${step}`;

export function flowReducer(state: FlowState, ev: FlowEvent): FlowState {
  switch (ev.type) {
    case "reset":
      return initialFlowState;
    case "start":
      return { status: "running", startedAt: ev.at, done: {} };
    case "step_start":
      return { ...state, current: { stage: ev.stage, step: ev.step } };
    case "step_done":
      return { ...state, done: { ...state.done, [stepKey(ev.stage, ev.step)]: { at: ev.at, payload: ev.payload } } };
    case "error":
      return { ...state, status: "error", error: ev.message };
    case "done":
      return { ...state, status: "done", finishedAt: ev.at, current: undefined };
  }
}

/**
 * Mock "banking webhook" emitter: walks the stages and emits an event per sub-step.
 * Returns a cancel function.
 */
export function runFlow(stages: Stage[], ctx: FlowContext, emit: (ev: FlowEvent) => void, fromStage = 0) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;

  const queue = stages
    .flatMap((s, stage) => s.steps.map((step, i) => ({ stage, step: i, def: step })))
    .filter((q) => q.stage >= fromStage);
  emit({ type: "start", at: Date.now() });

  const next = (i: number) => {
    if (cancelled) return;
    if (i >= queue.length) return emit({ type: "done", at: Date.now() });
    const { stage, step, def } = queue[i];
    emit({ type: "step_start", stage, step, at: Date.now() });
    timer = setTimeout(() => {
      if (cancelled) return;
      emit({ type: "step_done", stage, step, at: Date.now(), payload: def.payload(ctx) });
      next(i + 1);
    }, def.durationMs);
  };
  next(0);

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

/** Stage index where the simulated routing starts inside the full journey. */
export const ROUTING_STAGE = FUNDING_STAGES.length + 2;
export const RELEASE_STAGE = FUNDING_STAGES.length + 1;
export const WORK_STAGE_INDEX = FUNDING_STAGES.length;

/** Funding, work and payout as one ordered list of stages. */
export const journeyStages = (route: PayoutRoute): Stage[] => [...FUNDING_STAGES, WORK_STAGE, ...payoutStages(route)];

/** Maps a stage/step id pair from the backend to its position in the journey. */
export function stepIndex(stageId: string, stepId: string) {
  const stages = journeyStages("sepa");
  const stage = stages.findIndex((s) => s.id === stageId);
  const step = stages[stage]?.steps.findIndex((st) => st.id === stepId) ?? -1;
  return stage < 0 || step < 0 ? null : { stage, step };
}

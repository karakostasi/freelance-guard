import { useAccount, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { getBlock, readContract, waitForTransactionReceipt } from "wagmi/actions";
import { parseEther, parseEventLogs, zeroAddress, type Abi } from "viem";
import { config, escrowAbi, escrowAddress } from "../wagmi";
import { EUR_PER_ETH, FUNDING_STAGES, stepKey, type FlowContext } from "../lib/fiatFlow";
import { useFlowRun } from "./useFlowRun";

export type FundingMilestone = { title: string; amount: string; days: string };

/** A payment made by bank transfer. `amount` is the total, split over the milestones. */
export type FundingForm = {
  payee: string;
  amount: string;
  description: string;
  milestones: FundingMilestone[];
  token?: "eth" | "eurc" | "usdc";
  /** Take the yield on the money while it is in escrow (US dollars only), instead of paying the surcharge. */
  useYield?: boolean;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fiat-to-escrow funding. Bank, AML, FX and mint steps are simulated; the signature, deposit and
 * "funded" steps happen on the real escrow contract and are driven by the wallet and the receipt.
 */
export function useFiatFunding(onFunded: (jobId: number) => void) {
  const { state, emit, reset } = useFlowRun("funding:live");
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const fund = async (form: FundingForm) => {
    const amountEur = Number(form.amount) * EUR_PER_ETH;
    const ctx: FlowContext = { jobId: "pending", amountEur };
    const start = (stage: number, step: number) => emit({ type: "step_start", stage, step, at: Date.now() });
    const finish = (stage: number, step: number, payload: Record<string, unknown>) =>
      emit({ type: "step_done", stage, step, at: Date.now(), payload });
    const simulate = async (stage: number, step: number, c = ctx) => {
      const def = FUNDING_STAGES[stage].steps[step];
      start(stage, step);
      await wait(def.durationMs);
      finish(stage, step, { simulated: true, ...def.payload(c) });
    };

    emit({ type: "start", at: Date.now() });
    try {
      // Stages 1-2: fiat inbound and tokenization (simulated)
      for (const stage of [0, 1]) for (let i = 0; i < FUNDING_STAGES[stage].steps.length; i++) await simulate(stage, i);

      // Stage 3: escrow deposit (real)
      await simulate(2, 0);
      start(2, 1);
      const items = form.milestones.map((m) => ({ title: m.title, amount: parseEther(m.amount), duration: Math.round(Number(m.days) * 86400) }));
      // The escrow prices the job: the payer sends the amount plus the surcharge.
      const [, , surcharge] = (await readContract(config, { address: escrowAddress, abi: escrowAbi as Abi, functionName: "quote", args: [zeroAddress, items.map((i) => i.amount), false] })) as readonly [bigint, bigint, bigint];
      const hash = await writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "createJob",
        // Every milestone is funded right away: a bank transfer is one payment for the total.
        args: [form.payee, zeroAddress, form.description, items, { verifier: zeroAddress, useYield: false, fundNow: true }],
        value: parseEther(form.amount) + surcharge,
      });
      finish(2, 1, {
        signer: address,
        txHash: hash,
        note: "Gas is paid by the signing wallet on this testnet. A production paymaster would sponsor it.",
      });

      start(2, 2);
      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status !== "success") throw new Error("Deposit transaction reverted");
      const block = await getBlock(config, { blockNumber: receipt.blockNumber });
      const [created] = parseEventLogs({ abi: escrowAbi as Abi, logs: receipt.logs, eventName: "JobCreated" });
      const id = Number((created.args as unknown as { id: bigint }).id);
      finish(2, 2, {
        chain: "Base Sepolia (84532)",
        contract: escrowAddress,
        function: "createJob",
        jobId: id,
        txHash: hash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: Number(receipt.gasUsed),
        blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
      });

      // Stage 4: milestone activated. Confirm FUNDED on chain; public RPCs can lag a block or two.
      start(3, 0);
      let status = 0;
      for (let attempt = 0; attempt < 8 && status !== 1; attempt++) {
        if (attempt) await wait(1000);
        const [, milestones] = (await readContract(config, { address: escrowAddress, abi: escrowAbi as Abi, functionName: "getJob", args: [BigInt(id)] })) as readonly [unknown, readonly { status: number }[]];
        status = milestones[0].status;
      }
      if (status !== 1) throw new Error("Deposit confirmed, but the escrow doesn't show FUNDED yet");
      finish(3, 0, { contract: escrowAddress, jobId: id, status: "FUNDED" });
      const after = { ...ctx, jobId: String(id) };
      await simulate(3, 1, after);
      await simulate(3, 2, after);

      emit({ type: "done", at: Date.now() });
      queryClient.invalidateQueries();
      onFunded(id);
    } catch (e) {
      emit({ type: "error", message: (e as Error).message.split("\n")[0] });
    }
  };

  return { state, fund, reset, running: state.status === "running" };
}

export { stepKey };

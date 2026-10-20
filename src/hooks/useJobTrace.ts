import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Abi } from "viem";
import { escrowAbi, escrowAddress, escrowDeployBlock } from "../wagmi";

export type TxInfo = { txHash: `0x${string}`; blockNumber: bigint; gasUsed: bigint; blockTime: number };
export type JobTrace = {
  created?: TxInfo;
  submitted?: TxInfo;
  released?: TxInfo & { kind: "Approved" | "Resolved" };
  /** Event lookup failed (usually an RPC log-range limit). */
  unavailable?: boolean;
};

const PAID = 4;
const FALLBACK_WINDOW = 9000n;

/** Real on-chain transactions behind a job: the funding tx and, once paid, the release tx. */
export function useJobTrace(id: number | undefined, status: number | undefined) {
  const client = usePublicClient();
  return useQuery<JobTrace>({
    queryKey: ["jobTrace", id, status],
    enabled: !!client && id !== undefined && !!status,
    retry: false,
    queryFn: async () => {
      if (!client || id === undefined) return {};
      try {
        const latest = await client.getBlockNumber();
        const fromBlock = escrowDeployBlock ?? (latest > FALLBACK_WINDOW ? latest - FALLBACK_WINDOW : 0n);
        const args = { id: BigInt(id) };
        const find = (eventName: string) =>
          client.getContractEvents({ address: escrowAddress, abi: escrowAbi as Abi, eventName, args, fromBlock });

        const toInfo = async (log: { transactionHash: `0x${string}`; blockNumber: bigint }): Promise<TxInfo> => {
          const [receipt, block] = await Promise.all([
            client.getTransactionReceipt({ hash: log.transactionHash }),
            client.getBlock({ blockNumber: log.blockNumber }),
          ]);
          return { txHash: log.transactionHash, blockNumber: log.blockNumber, gasUsed: receipt.gasUsed, blockTime: Number(block.timestamp) };
        };

        const [created, submitted, approved, resolved] = await Promise.all([
          find("JobCreated"),
          (status ?? 0) >= 2 ? find("WorkSubmitted") : [],
          status === PAID ? find("Approved") : [],
          status === PAID ? find("Resolved") : [],
        ]);

        const trace: JobTrace = {};
        if (created[0]) trace.created = await toInfo(created[0]);
        if (submitted[0]) trace.submitted = await toInfo(submitted[0]);
        const release = approved[0] ?? resolved[0];
        if (release) trace.released = { ...(await toInfo(release)), kind: approved[0] ? "Approved" : "Resolved" };
        if (!trace.created) trace.unavailable = true;
        return trace;
      } catch {
        return { unavailable: true };
      }
    },
  });
}

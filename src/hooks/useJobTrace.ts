import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Abi, PublicClient } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import type { Milestone } from "../lib/jobs";

export type TxInfo = { txHash: `0x${string}`; blockNumber: bigint; gasUsed: bigint; blockTime: number; /** Who sent the transaction. */ from: string };
export type JobTrace = {
  created?: TxInfo;
  submitted?: TxInfo;
  released?: TxInfo & { kind: "Approved" | "Resolved" };
  /** For a refunded milestone: the refund, and whether the arbiter decided it. */
  refunded?: TxInfo & { viaArbiter: boolean };
  /** The lookup failed (usually the RPC refusing or rate-limiting requests), with the reason. */
  unavailable?: boolean;
  error?: string;
};

const PAID = 4;
const REFUNDED = 5;
const RANGE = 9000n; // public RPCs cap how many blocks one log query may cover

const blockCache = new Map<string, bigint>();

/**
 * The first block whose timestamp is `timestamp`. The contract records block.timestamp when a milestone is
 * funded or submitted, so that timestamp identifies the exact block of the transaction, with no need to
 * know where the contract was deployed.
 */
async function blockAtTimestamp(client: PublicClient, timestamp: number): Promise<bigint> {
  const key = `${client.chain?.id}:${timestamp}`;
  const cached = blockCache.get(key);
  if (cached !== undefined) return cached;

  const timeAt = async (blockNumber: bigint) => Number((await client.getBlock({ blockNumber })).timestamp);
  const latest = await client.getBlock();
  const elapsed = Math.max(Number(latest.timestamp) - timestamp, 0);

  // Estimate where the block is from the chain's recent block time, then bracket it and bisect. That is
  // about ten requests instead of one per halving of the whole chain, which matters on a rate-limited RPC.
  const sample = latest.number > 1000n ? 1000n : latest.number;
  const blockTime = sample > 0n ? Math.max((Number(latest.timestamp) - (await timeAt(latest.number - sample))) / Number(sample), 0.1) : 1;
  const estimate = latest.number - BigInt(Math.round(elapsed / blockTime));
  const clamp = (n: bigint) => (n < 0n ? 0n : n > latest.number ? latest.number : n);

  let width = 64n;
  let lo = clamp(estimate - width);
  while (lo > 0n && (await timeAt(lo)) >= timestamp) {
    width *= 4n;
    lo = clamp(estimate - width);
  }
  let hi = clamp(estimate + width);
  while (hi < latest.number && (await timeAt(hi)) < timestamp) {
    width *= 4n;
    hi = clamp(estimate + width);
  }
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (Number((await client.getBlock({ blockNumber: mid })).timestamp) < timestamp) lo = mid + 1n;
    else hi = mid;
  }
  blockCache.set(key, lo);
  return lo;
}

/** Real on-chain transactions behind one milestone: funding, delivery and how it ended. */
export function useJobTrace(id: number | undefined, milestone: number | undefined, ms: Milestone | undefined) {
  const client = usePublicClient();
  const status = ms?.status;
  return useQuery<JobTrace>({
    queryKey: ["jobTrace", id, milestone, status, ms?.submittedAt.toString()],
    enabled: !!client && id !== undefined && milestone !== undefined && !!status,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      if (!client || id === undefined || milestone === undefined || !ms) return {};
      try {
        const args = { id: BigInt(id), milestone: BigInt(milestone) };
        const find = (eventName: string, fromBlock: bigint, toBlock: bigint) =>
          client.getContractEvents({ address: escrowAddress, abi: escrowAbi as Abi, eventName, args, fromBlock, toBlock });

        // Searches forward from `from` in ranges the RPC accepts, stopping at the first match.
        const findFrom = async (eventName: string, from: bigint, to: bigint) => {
          for (let start = from; start <= to; start += RANGE) {
            const logs = await find(eventName, start, start + RANGE - 1n < to ? start + RANGE - 1n : to);
            if (logs[0]) return logs;
          }
          return [];
        };

        const toInfo = async (log: { transactionHash: `0x${string}`; blockNumber: bigint }): Promise<TxInfo> => {
          const [receipt, block] = await Promise.all([
            client.getTransactionReceipt({ hash: log.transactionHash }),
            client.getBlock({ blockNumber: log.blockNumber }),
          ]);
          return { txHash: log.transactionHash, blockNumber: log.blockNumber, gasUsed: receipt.gasUsed, blockTime: Number(block.timestamp), from: receipt.from };
        };

        const trace: JobTrace = {};
        const latest = await client.getBlockNumber();

        // Funding: deadline = block time of the funding tx + duration, so the funding block's timestamp is known.
        const fundedAt = Number(ms.deadline) - ms.duration;
        const fundedBlock = await blockAtTimestamp(client, fundedAt);
        const created = await find("MilestoneFunded", fundedBlock, fundedBlock);
        if (created[0]) trace.created = await toInfo(created[0]);

        // Delivery: submittedAt is the block time of the submitWork tx.
        let after = fundedBlock;
        if (ms.submittedAt > 0n) {
          const submittedBlock = await blockAtTimestamp(client, Number(ms.submittedAt));
          const submitted = await find("WorkSubmitted", submittedBlock, submittedBlock);
          if (submitted[0]) trace.submitted = await toInfo(submitted[0]);
          after = submittedBlock;
        }

        // How it ended: its time is not stored, so look from the last known block onwards.
        if (status === PAID) {
          const approved = await findFrom("Approved", after, latest);
          const resolved = approved[0] ? [] : await findFrom("Resolved", after, latest);
          const release = approved[0] ?? resolved[0];
          if (release) trace.released = { ...(await toInfo(release)), kind: approved[0] ? "Approved" : "Resolved" };
        } else if (status === REFUNDED) {
          const refunded = await findFrom("Refunded", after, latest);
          const resolved = refunded[0] ? await find("Resolved", refunded[0].blockNumber, refunded[0].blockNumber) : [];
          if (refunded[0]) trace.refunded = { ...(await toInfo(refunded[0])), viaArbiter: !!resolved[0] };
        }

        if (!trace.created) trace.unavailable = true;
        return trace;
      } catch (e) {
        const error = e as { shortMessage?: string; message?: string };
        return { unavailable: true, error: (error.shortMessage ?? error.message ?? "unknown error").split("\n")[0] };
      }
    },
  });
}

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
  /** Lookups that failed, each with its reason (usually the RPC refusing or rate-limiting requests). */
  issues?: string[];
};

const PAID = 4;
const REFUNDED = 5;
const RANGE = 9000n; // public RPCs cap how many blocks one log query may cover
const MIN_RANGE = 100n;

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

/** The most useful line of an RPC error: viem puts the node's own message in `details`. */
const describe = (e: unknown) => {
  const err = e as { details?: string; shortMessage?: string; message?: string };
  return (err.details || err.shortMessage || err.message || "unknown error").split("\n")[0];
};

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
      const args = { id: BigInt(id), milestone: BigInt(milestone) };
      const trace: JobTrace = {};
      const issues: string[] = [];

      const find = (eventName: string, fromBlock: bigint, toBlock: bigint) =>
        client.getContractEvents({ address: escrowAddress, abi: escrowAbi as Abi, eventName, args, fromBlock, toBlock });

      // Searches forward in ranges the RPC accepts, stopping at the first match. If a range is refused, it retries smaller.
      const findFrom = async (eventName: string, from: bigint, to: bigint) => {
        let size = RANGE;
        for (let start = from; start <= to; ) {
          const end = start + size - 1n < to ? start + size - 1n : to;
          try {
            const logs = await find(eventName, start, end);
            if (logs[0]) return logs;
            start = end + 1n;
          } catch (e) {
            if (size <= MIN_RANGE) throw e;
            size = size / 4n > MIN_RANGE ? size / 4n : MIN_RANGE;
          }
        }
        return [];
      };

      const toInfo = async (log: { transactionHash: `0x${string}`; blockNumber: bigint }): Promise<TxInfo> => {
        const [receipt, block] = await Promise.all([client.getTransactionReceipt({ hash: log.transactionHash }), client.getBlock({ blockNumber: log.blockNumber })]);
        return { txHash: log.transactionHash, blockNumber: log.blockNumber, gasUsed: receipt.gasUsed, blockTime: Number(block.timestamp), from: receipt.from };
      };

      // Each lookup stands alone, so one the RPC refuses doesn't cost the links that did work.
      const attempt = async <T,>(label: string, work: () => Promise<T>): Promise<T | undefined> => {
        try {
          return await work();
        } catch (e) {
          issues.push(`${label}: ${describe(e)}`);
          return undefined;
        }
      };

      // Funding: deadline = block time of the funding tx + duration, so the funding block's timestamp is known.
      const fundedBlock = await attempt("funding block", () => blockAtTimestamp(client, Number(ms.deadline) - ms.duration));
      if (fundedBlock !== undefined) {
        await attempt("funding transaction", async () => {
          const created = await find("MilestoneFunded", fundedBlock, fundedBlock);
          if (created[0]) trace.created = await toInfo(created[0]);
        });
      }

      // Delivery: submittedAt is the block time of the submitWork tx.
      let after = fundedBlock;
      if (ms.submittedAt > 0n) {
        const submittedBlock = await attempt("delivery block", () => blockAtTimestamp(client, Number(ms.submittedAt)));
        if (submittedBlock !== undefined) {
          after = submittedBlock;
          await attempt("delivery transaction", async () => {
            const submitted = await find("WorkSubmitted", submittedBlock, submittedBlock);
            if (submitted[0]) trace.submitted = await toInfo(submitted[0]);
          });
        }
      }

      // How it ended: its time is not stored, so look from the last known block onwards.
      if ((status === PAID || status === REFUNDED) && after !== undefined) {
        const from = after;
        await attempt(status === PAID ? "payment transaction" : "refund transaction", async () => {
          const latest = await client.getBlockNumber();
          if (status === PAID) {
            const approved = await findFrom("Approved", from, latest);
            const resolved = approved[0] ? [] : await findFrom("Resolved", from, latest);
            const release = approved[0] ?? resolved[0];
            if (release) trace.released = { ...(await toInfo(release)), kind: approved[0] ? "Approved" : "Resolved" };
          } else {
            const refunded = await findFrom("Refunded", from, latest);
            const resolved = refunded[0] ? await find("Resolved", refunded[0].blockNumber, refunded[0].blockNumber) : [];
            if (refunded[0]) trace.refunded = { ...(await toInfo(refunded[0])), viaArbiter: !!resolved[0] };
          }
        });
      }

      if (issues.length) trace.issues = issues;
      return trace;
    },
  });
}

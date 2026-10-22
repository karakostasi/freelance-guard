import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContract, useReadContracts, usePublicClient } from "wagmi";
import type { Abi } from "viem";
import { escrowAbi, escrowAddress, escrowDeployBlock } from "../wagmi";
import type { Job, Milestone } from "../lib/jobs";
import { computeReputation, jobKey } from "../lib/reputation";

type RawJob = readonly [Omit<Job, "milestones">, readonly Milestone[]];

const RANGE = 9000n; // public RPCs cap how many blocks one log query may cover
const PARALLEL = 4;

/** Every milestone ever disputed, as "id:milestone". Resolved disputes are not visible in the contract's state. */
function useDisputed(jobCount: number) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["disputedMilestones", escrowAddress, jobCount],
    enabled: !!client && escrowDeployBlock !== undefined,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const keys = new Set<string>();
      const latest = await client!.getBlockNumber();
      const starts: bigint[] = [];
      for (let s = escrowDeployBlock!; s <= latest; s += RANGE) starts.push(s);
      for (let i = 0; i < starts.length; i += PARALLEL) {
        const batch = await Promise.all(
          starts.slice(i, i + PARALLEL).map((from) =>
            client!.getContractEvents({ address: escrowAddress, abi: escrowAbi as Abi, eventName: "Disputed", fromBlock: from, toBlock: from + RANGE - 1n < latest ? from + RANGE - 1n : latest }),
          ),
        );
        for (const log of batch.flat()) {
          const { id, milestone } = (log as unknown as { args: { id: bigint; milestone: bigint } }).args;
          keys.add(jobKey(Number(id), Number(milestone)));
        }
      }
      return keys;
    },
  });
}

/**
 * An account's record as client and as freelancer. Reads every job once (shared with the job lists) and the
 * Disputed events. If the events can't be read, `approximate` is true and past disputes that ended in a payment are missing.
 */
export function useReputation(address: string | undefined) {
  const { data: count } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "jobCount" });
  const total = Number(count ?? 0n);
  const { data, isLoading } = useReadContracts({
    contracts: Array.from({ length: total }, (_, i) => ({ address: escrowAddress, abi: escrowAbi as Abi, functionName: "getJob", args: [BigInt(i + 1)] })),
    query: { enabled: total > 0 },
  });
  const disputes = useDisputed(total);

  const reputation = useMemo(() => {
    if (!address || !data) return undefined;
    const jobs = data.flatMap((r, i) => {
      const raw = r.result as RawJob | undefined;
      return raw ? [{ id: i + 1, job: { ...raw[0], milestones: [...raw[1]] } as Job }] : [];
    });
    return computeReputation(jobs, address, disputes.data ?? new Set());
  }, [address, data, disputes.data]);

  return { reputation, isLoading: isLoading || disputes.isLoading, approximate: !disputes.isSuccess };
}

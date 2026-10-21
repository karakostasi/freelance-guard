import { useAccount, useReadContract, useReadContracts } from "wagmi";
import type { Abi } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { STATUS, type Job, type Milestone } from "../lib/jobs";
import { useEscrowConfig } from "./useEscrowConfig";

type RawJob = readonly [Omit<Job, "milestones">, readonly Milestone[]];

/** Jobs the connected account is part of (plus jobs with a dispute, for the arbiter), newest first. */
export function useMyJobs() {
  const { address } = useAccount();
  const { arbiter } = useEscrowConfig();
  const { data: count } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "jobCount" });
  const total = Number(count ?? 0n);
  const { data } = useReadContracts({
    contracts: Array.from({ length: total }, (_, i) => ({
      address: escrowAddress,
      abi: escrowAbi as Abi,
      functionName: "getJob",
      args: [BigInt(i + 1)],
    })),
    query: { enabled: total > 0 },
  });

  const me = address?.toLowerCase();
  const isArbiter = !!me && arbiter?.toLowerCase() === me;
  return (data ?? [])
    .map((r, i) => {
      const raw = r.result as RawJob | undefined;
      return { id: i + 1, job: raw ? ({ ...raw[0], milestones: [...raw[1]] } as Job) : undefined };
    })
    .filter(
      ({ job }) =>
        job &&
        (job.client.toLowerCase() === me ||
          job.freelancer.toLowerCase() === me ||
          (isArbiter && job.milestones.some((m) => STATUS[m.status] === "Disputed"))),
    )
    .reverse() as { id: number; job: Job }[];
}

import { useAccount, useReadContract, useReadContracts } from "wagmi";
import type { Abi } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { STATUS, jobFromChain, type Job, type RawJob } from "../lib/jobs";
import { useEscrowConfig } from "./useEscrowConfig";

/**
 * Jobs the connected account is part of (plus jobs with a dispute, for the arbiter), newest first, and whether they are
 * still being read. Until they are, an empty list means "not yet", not "none", and a page must not say there are no jobs.
 */
export function useMyJobs() {
  const { address } = useAccount();
  const { arbiter } = useEscrowConfig();
  const { data: count, isPending: countPending } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "jobCount" });
  const total = Number(count ?? 0n);
  const { data, isPending: jobsPending } = useReadContracts({
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
  // First the number of jobs, then the jobs themselves (there is nothing to read when there are none).
  const loading = countPending || (total > 0 && jobsPending);
  const jobs = (data ?? [])
    .map((r, i) => {
      const raw = r.result as RawJob | undefined;
      return { id: i + 1, job: raw ? jobFromChain(raw) : undefined };
    })
    .filter(
      ({ job }) =>
        job &&
        (job.payer.toLowerCase() === me ||
          job.payee.toLowerCase() === me ||
          (isArbiter && job.milestones.some((m) => STATUS[m.status] === "Disputed"))),
    )
    .reverse() as { id: number; job: Job }[];
  return { jobs, loading };
}

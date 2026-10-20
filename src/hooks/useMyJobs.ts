import { useAccount, useReadContract, useReadContracts } from "wagmi";
import type { Abi } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { STATUS, type Job } from "../lib/jobs";
import { useEscrowConfig } from "./useEscrowConfig";

/** Jobs the connected account is part of (plus disputed ones, for the arbiter), newest first. */
export function useMyJobs() {
  const { address } = useAccount();
  const { arbiter } = useEscrowConfig();
  const { data: count } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "jobCount" });
  const total = Number(count ?? 0n);
  const { data } = useReadContracts({
    contracts: Array.from({ length: total }, (_, i) => ({
      address: escrowAddress,
      abi: escrowAbi as Abi,
      functionName: "jobs",
      args: [BigInt(i + 1)],
    })),
    query: { enabled: total > 0 },
  });

  const me = address?.toLowerCase();
  const isArbiter = !!me && arbiter?.toLowerCase() === me;
  return (data ?? [])
    .map((r, i) => ({ id: i + 1, job: r.result as Job | undefined }))
    .filter(
      ({ job }) =>
        job && (job[0].toLowerCase() === me || job[1].toLowerCase() === me || (isArbiter && STATUS[job[5]] === "Disputed")),
    )
    .reverse() as { id: number; job: Job }[];
}

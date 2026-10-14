import { useReadContract } from "wagmi";
import { escrowAbi, escrowAddress } from "../wagmi";

export function useEscrowConfig() {
  const { data: reviewPeriod } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "reviewPeriod" });
  const { data: arbiter } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "arbiter" });
  return { reviewPeriod: reviewPeriod as bigint | undefined, arbiter: arbiter as string | undefined };
}

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt } from "wagmi";

// Public RPCs sit behind load balancers, so the first read after a receipt can
// still hit a node that hasn't seen the block. Refresh again shortly after.
const REFRESH_DELAYS_MS = [0, 2000, 5000];

export function useRefreshOnConfirm(hash: `0x${string}` | undefined) {
  const queryClient = useQueryClient();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (!isSuccess) return;
    const timers = REFRESH_DELAYS_MS.map((ms) => setTimeout(() => queryClient.invalidateQueries(), ms));
    return () => timers.forEach(clearTimeout);
  }, [isSuccess, queryClient]);
  return isLoading;
}

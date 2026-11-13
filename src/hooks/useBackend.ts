import { useQuery } from "@tanstack/react-query";
import { API_URL, api } from "../lib/api";

/** Backend health check. The app falls back to the local simulation when it doesn't answer. */
export function useBackendStatus() {
  const { data, error, isFetched } = useQuery({
    queryKey: ["backend-health"],
    queryFn: api.health,
    retry: false,
    refetchInterval: 10_000,
  });
  return {
    online: !!data?.ok,
    checked: isFetched,
    url: API_URL,
    error: error ? (error as Error).message : null,
    /** Whether card and bank payments, and bank payouts, are open. An older backend that doesn't say has them. */
    bankRails: data?.bankRails !== false,
    /** Whether the backend can send people to Coinbase to buy EURC or USDC. An older backend that doesn't say can't. */
    onramp: data?.onramp === true,
    /** The network the backend is on, when it says. */
    chainId: data?.chainId,
  };
}

export function useBackendOnline() {
  return useBackendStatus().online;
}

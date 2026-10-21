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
  return { online: !!data?.ok, checked: isFetched, url: API_URL, error: error ? (error as Error).message : null };
}

export function useBackendOnline() {
  return useBackendStatus().online;
}

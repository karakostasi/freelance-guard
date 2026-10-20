import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/** True while the backend answers its health check. The app falls back to the local simulation otherwise. */
export function useBackendOnline() {
  const { data } = useQuery({
    queryKey: ["backend-health"],
    queryFn: api.health,
    retry: false,
    refetchInterval: 10_000,
  });
  return !!data?.ok;
}

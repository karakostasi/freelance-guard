import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useBackendOnline } from "./useBackend";
import { useRunEvents } from "./useRunEvents";

/** The backend payment run linked to a job, with its live step state, or null when there is none. */
export function useBackendRun(jobId: number) {
  const online = useBackendOnline();
  const { data: run } = useQuery({
    queryKey: ["backend-run", jobId],
    queryFn: () => api.runForJob(jobId),
    enabled: online,
    retry: false,
  });
  const { state } = useRunEvents(run?.id ?? null);
  return run ? { run, state } : null;
}

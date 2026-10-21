import { useQuery } from "@tanstack/react-query";
import { loadDoc } from "../lib/files";

/** A document the backend holds, checked against its hash. Content-addressed, so it never changes. */
export function useDoc(reference: string | undefined) {
  return useQuery({
    queryKey: ["doc", reference],
    queryFn: () => loadDoc(reference!),
    enabled: !!reference,
    staleTime: Infinity,
    retry: 1,
  });
}

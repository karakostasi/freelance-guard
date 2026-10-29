import { useQuery } from "@tanstack/react-query";
import { payoutApi } from "../lib/api";
import { useBackendStatus } from "./useBackend";

/** How the payee of a job is paid, as anyone may see it. Nothing is asked of the wallet, and nothing without the backend. */
export function usePayoutOf(address: string | undefined) {
  const { online } = useBackendStatus();
  return useQuery({
    queryKey: ["payout", address?.toLowerCase()],
    queryFn: () => payoutApi.of(address!),
    enabled: !!address && online,
    staleTime: 30_000,
    retry: false,
  });
}

/** The words for it: "a bank account in euros (…3000)". */
export function describePayout(pref: { route: "sepa" | "ach" | "eurc" | null; last4?: string } | undefined) {
  if (!pref?.route) return null;
  if (pref.route === "eurc") return "the stablecoin, kept in their wallet";
  const where = pref.route === "ach" ? "a US bank account in dollars" : "a bank account in euros";
  return pref.last4 ? `${where} (…${pref.last4})` : where;
}

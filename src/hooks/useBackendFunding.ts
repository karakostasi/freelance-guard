import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { api, type ServerEvent } from "../lib/api";
import { userRejected } from "../lib/errors";
import { sendTransactions, type Call } from "../lib/tx";
import { initialFlowState, stepIndex, stepKey, type FlowState } from "../lib/fiatFlow";
import { useRunEvents } from "./useRunEvents";
import type { FundingForm } from "./useFiatFunding";

/** Sends what the backend prepared (the call, plus a token approval first for token jobs) and tells it how gas was paid. */
async function sendPrepared(prep: { tx: NonNullable<ServerEvent["tx"]>; approval?: ServerEvent["approval"] }, address: `0x${string}`, runId: string) {
  const calls: Call[] = [
    ...(prep.approval ? [{ to: prep.approval.to, data: prep.approval.data }] : []),
    { to: prep.tx.to, data: prep.tx.data, value: BigInt(prep.tx.value) },
  ];
  await sendTransactions(address, calls, (sponsored) => void api.markSigned(runId, sponsored ? "sponsored" : "wallet"));
}

/**
 * Fiat-to-escrow funding driven by the backend. The backend runs the bank, AML, FX and ledger steps,
 * prepares the escrow call, watches the chain and streams every step. This hook only starts the
 * payment, triggers the sandbox bank transfer and has the wallet sign the call the backend asks for.
 */
export function useBackendFunding(onFunded: (jobId: number) => void) {
  const { address } = useAccount();
  const [runId, setRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { events, state: raw } = useRunEvents(runId);
  const handled = useRef(new Set<string>());
  const notified = useRef<string | null>(null);

  const fundedKey = (() => {
    const idx = stepIndex("activated", "dashboard");
    return idx ? stepKey(idx.stage, idx.step) : "";
  })();
  const funded = !!raw.done[fundedKey];
  const jobId = (() => {
    const idx = stepIndex("escrow", "deposit");
    return idx ? (raw.done[stepKey(idx.stage, idx.step)]?.payload.jobId as number | undefined) : undefined;
  })();

  useEffect(() => {
    if (!runId || !address) return;
    for (const ev of events) {
      const key = `${runId}:${ev.seq}`;
      if (ev.type !== "action_required" || !ev.tx || handled.current.has(key)) continue;
      handled.current.add(key);
      sendPrepared({ tx: ev.tx, approval: ev.approval }, address, runId).catch((e: Error) => api.cancel(runId, userRejected(e) ? "Signature rejected in the wallet" : e.message.split("\n")[0]));
    }
  }, [events, runId, address]);

  useEffect(() => {
    if (runId && funded && jobId !== undefined && notified.current !== runId) {
      notified.current = runId;
      onFunded(jobId);
    }
  }, [runId, funded, jobId, onFunded]);

  const fund = async (form: FundingForm) => {
    if (!address) return;
    setStartError(null);
    try {
      const { run, bank } = await api.createPayment({ payer: address, ...form, route: form.route ?? "sepa", token: form.token ?? "eth" });
      setRunId(run.id);
      await api.bankTransfer(bank.reference);
    } catch (e) {
      setStartError((e as Error).message);
    }
  };

  const reset = () => {
    setRunId(null);
    setStartError(null);
  };

  // Once the dashboard step is done the funding journey is complete; the job's own journey takes over.
  const state: FlowState = startError
    ? { ...initialFlowState, status: "error", error: startError }
    : funded
      ? { ...raw, status: "done", current: undefined }
      : raw;

  return { state, fund, reset, running: state.status === "running" };
}

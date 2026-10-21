import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { getCapabilities, getChainId, sendCalls, sendTransaction, waitForCallsStatus, waitForTransactionReceipt } from "wagmi/actions";
import { config } from "../wagmi";
import { api, type ServerEvent } from "../lib/api";
import { initialFlowState, stepIndex, stepKey, type FlowState } from "../lib/fiatFlow";
import { useRunEvents } from "./useRunEvents";
import type { FundingForm } from "./useFiatFunding";

const PAYMASTER_URL = import.meta.env.VITE_PAYMASTER_URL as string | undefined;

const userRejected = (e: unknown): boolean => {
  for (let err = e as { name?: string; code?: number; cause?: unknown } | undefined; err; err = err.cause as typeof err) {
    if (err.code === 4001 || err.name === "UserRejectedRequestError") return true;
  }
  return false;
};

/**
 * Sends what the backend prepared: the call, plus a token approval first for token jobs. With a paymaster
 * URL and a wallet that supports sponsored calls (EIP-5792 + ERC-7677) the gas is sponsored and both go
 * in one batch; otherwise, or if that path fails, the wallet signs them one by one and pays the gas.
 */
async function sendPrepared(prep: { tx: NonNullable<ServerEvent["tx"]>; approval?: ServerEvent["approval"] }, address: `0x${string}`, runId: string) {
  const calls = [
    ...(prep.approval ? [{ to: prep.approval.to, data: prep.approval.data, value: 0n }] : []),
    { to: prep.tx.to, data: prep.tx.data, value: BigInt(prep.tx.value) },
  ];
  if (PAYMASTER_URL) {
    try {
      const chainId = await getChainId(config);
      const caps = (await getCapabilities(config, { account: address })) as Record<number, { paymasterService?: { supported?: boolean } } | undefined>;
      if (caps[chainId]?.paymasterService?.supported) {
        const { id } = await sendCalls(config, {
          calls,
          capabilities: { paymasterService: { url: PAYMASTER_URL } },
        });
        await api.markSigned(runId, "sponsored");
        await waitForCallsStatus(config, { id });
        return;
      }
    } catch (e) {
      if (userRejected(e)) throw e;
      // sponsored path unavailable: fall through to a normal transaction
    }
  }
  await api.markSigned(runId, "wallet");
  for (const [i, call] of calls.entries()) {
    const hash = await sendTransaction(config, call);
    if (i < calls.length - 1) await waitForTransactionReceipt(config, { hash });
  }
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

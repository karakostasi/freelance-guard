import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWatchContractEvent } from "wagmi";
import type { Abi } from "viem";
import { Check, RotateCcw } from "lucide-react";
import { FlowStepper, type FlowMode } from "./FlowStepper";
import { NextStep } from "./NextStep";
import { JobList } from "./JobList";
import { WalletCard } from "./WalletCard";
import { MilestoneDetails } from "./MilestoneDetails";
import { useBackendFunding } from "../hooks/useBackendFunding";
import { useBackendStatus } from "../hooks/useBackend";
import { useBackendRun } from "../hooks/useBackendRun";
import { takePendingPayment } from "../lib/pendingPayment";
import { useFiatFunding, type FundingForm } from "../hooks/useFiatFunding";
import { useFlowRun } from "../hooks/useFlowRun";
import { useJobTrace } from "../hooks/useJobTrace";
import { useMyJobs } from "../hooks/useMyJobs";
import { deriveJourney, simulatedPayloads } from "../lib/chainFlow";
import { FUNDING_STAGES, ROUTING_STAGE, journeyStages, type FlowState, type PayoutRoute } from "../lib/fiatFlow";
import { STATUS_CLASS, STATUS_LABEL, currentMilestone, type Job } from "../lib/jobs";
import { parseDescription, receiptPath } from "../lib/documents";
import { SpecView } from "./DocView";
import { toEur, tokenOf } from "../lib/tokens";
import { escrowAbi, escrowAddress } from "../wagmi";
import styles from "../App.module.css";
import flow from "./FlowStepper.module.css";
import page from "./FlowPage.module.css";

/** Refresh every chain read the moment the escrow emits any event, so the journey updates live. */
function useLiveEscrowEvents() {
  const queryClient = useQueryClient();
  useWatchContractEvent({
    address: escrowAddress,
    abi: escrowAbi as Abi,
    onLogs: () => queryClient.invalidateQueries(),
  });
}

export function FlowPage({ jobId: routeJobId }: { jobId?: string }) {
  const [mode, setMode] = useState<FlowMode>("simple");
  const [selectedId, setSelectedId] = useState(routeJobId ?? "");
  const mine = useMyJobs();
  useLiveEscrowEvents();

  // Once a new payment lands on-chain, hand over from the live run to that job's own journey.
  const { online: backendOnline, checked: backendChecked, url: backendUrl, error: backendError } = useBackendStatus();
  const [liveMode, setLiveMode] = useState<"backend" | "local">("local");
  const resetLive = useRef<() => void>(() => {});
  const onFunded = (newId: number) => {
    setSelectedId(String(newId));
    setTimeout(() => resetLive.current(), 1500);
  };
  const backend = useBackendFunding(onFunded);
  const local = useFiatFunding(onFunded);
  const live = liveMode === "backend" ? backend : local;
  useEffect(() => {
    resetLive.current = () => {
      backend.reset();
      local.reset();
    };
  });
  const showingLive = live.state.status !== "idle";

  // The mode is picked when the payment starts, so losing the backend mid-run doesn't swap the view.
  const startPayment = (form: FundingForm) => {
    setLiveMode(backendOnline ? "backend" : "local");
    if (backendOnline) backend.fund(form);
    else local.fund(form);
  };

  // A bank-transfer payment started on the Jobs page is picked up here, once we know if the backend is up.
  const startRef = useRef(startPayment);
  useEffect(() => {
    startRef.current = startPayment;
  });
  useEffect(() => {
    if (!backendChecked) return;
    const waiting = takePendingPayment();
    if (waiting) startRef.current(waiting);
  }, [backendChecked]);

  const id = selectedId || routeJobId || String(mine[0]?.id ?? "");
  const selected = mine.find((m) => String(m.id) === id);

  return (
    <div className={page.page}>
      <div className={flow.header}>
        <h2 className={page.title}>Payment flow</h2>
        <span className={backendOnline ? flow.pillLive : flow.demo}>{backendOnline ? "Live backend" : "Offline demo"}</span>
        {!backendOnline && (
          <span className={flow.muted}>
            Can&apos;t reach {backendUrl}
            {backendError ? ` (${backendError})` : ""}
          </span>
        )}
      </div>

      <div className={page.layout}>
        <WalletCard className={page.wallet} />
        <JobList jobs={mine} selectedId={id} onSelect={setSelectedId} emptyText={'No jobs for this account yet. Use "Create a job" to start one.'} />
        {showingLive ? (
          <>
            <div className={page.top}>
              <div className={flow.blockHeader}>
                <h3 className={page.subtitle}>New payment</h3>
                {!live.running && (
                  <button className={styles.ghostButton} onClick={live.reset}>
                    <RotateCcw size={14} /> Dismiss
                  </button>
                )}
              </div>
            </div>
            <div className={`${page.stepperRow} ${page.block}`}>
              <FlowStepper stages={journeyStages("sepa")} state={live.state} mode={mode} onModeChange={setMode} timer />
            </div>
          </>
        ) : selected ? (
          <JobJourney key={selected.id} id={selected.id} job={selected.job} mode={mode} onModeChange={setMode} />
        ) : (
          <div className={page.top}>
            <p className={flow.muted}>{mine.length > 0 ? "Pick a job from the list." : "Nothing to show yet."}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function JobJourney({ id, job, mode, onModeChange }: { id: number; job: Job; mode: FlowMode; onModeChange: (mode: FlowMode) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const index = picked ?? currentMilestone(job);
  const ms = job.milestones[index];
  const multi = job.milestones.length > 1;
  const { spec, ref } = parseDescription(job.description);
  const hasSpec = !!spec || !!ref;
  const status = ms.status;
  const { data: trace, refetch, isFetching } = useJobTrace(id, index, ms);
  const amountEur = toEur(tokenOf(job), ms.amount);
  const sim = useMemo(() => simulatedPayloads(FUNDING_STAGES, { jobId: String(id), amountEur }), [id, amountEur]);

  const [localRoute, setRoute] = useState<PayoutRoute>("sepa");
  const localPayout = useFlowRun(`journey-payout:${id}:${index}`);
  // Backend payment runs only cover the first (and only) milestone of the job they created.
  const backendRun = useBackendRun(id);
  const backend = index === 0 ? backendRun : null;
  const route = backend?.run.route ?? localRoute;
  const stages = journeyStages(route);

  // With a backend run, bank/ledger payloads and the whole payout come from the backend's real events.
  const fromBackend = (keep: (stage: number) => boolean) =>
    Object.fromEntries(Object.entries(backend?.state.done ?? {}).filter(([k]) => keep(Number(k.split(".")[0]))));
  const simPayloads = backend
    ? { ...sim, ...Object.fromEntries(Object.entries(fromBackend((s) => s < FUNDING_STAGES.length)).map(([k, v]) => [k, v.payload])) }
    : sim;
  const routingDone = fromBackend((s) => s >= ROUTING_STAGE) as FlowState["done"];
  const routingActive = !!backend && backend.state.status === "running" && (backend.state.current?.stage ?? -1) >= ROUTING_STAGE;
  const payoutState: FlowState = backend
    ? {
        status: routingActive ? "running" : backend.state.status === "done" ? "done" : "idle",
        done: routingDone,
        current: routingActive ? backend.state.current : undefined,
        startedAt: backend.state.startedAt,
        finishedAt: backend.state.finishedAt,
      }
    : localPayout.state;
  const payout = { ...localPayout, state: payoutState };
  const journey = deriveJourney(id, job, ms, trace, simPayloads, payoutState, route);

  return (
    <>
      <div className={page.top}>
        {multi && (
          <div className={page.msTabs} role="tablist" aria-label="Milestones">
            {job.milestones.map((m, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === index}
                className={`${page.msTab} ${STATUS_CLASS[m.status]} ${i === index ? page.msTabActive : ""}`}
                onClick={() => setPicked(i)}
                title={`${m.title || "Untitled"}: ${STATUS_LABEL[m.status]}`}
              >
                <span className={page.msDot} />
                <span className={page.msNum}>{i + 1}</span>
                <span className={page.msTitle}>{m.title || "Untitled"}</span>
                {m.status === 4 && <Check size={13} />}
              </button>
            ))}
          </div>
        )}

        {hasSpec && (
          <div className={page.spec}>
            <h3 className={styles.groupTitle}>About this job</h3>
            <SpecView description={job.description} />
          </div>
        )}

        <MilestoneDetails job={job} index={index} trace={trace} onRetry={() => refetch()} loading={isFetching} receiptHref={`#${receiptPath(id, index)}`} />

        <NextStep
          id={id}
          index={index}
          job={job}
          payout={{
            state: payout.state,
            route,
            setRoute,
            start: () => localPayout.start(stages, { jobId: String(id), amountEur, route }, ROUTING_STAGE),
            reset: localPayout.reset,
            amountEur,
            auto: !!backend,
          }}
        />

      </div>

      <div className={`${page.stepperRow} ${page.block}`}>
        {status === 0 && <p className={flow.muted}>These steps start once the milestone is funded.</p>}
        <FlowStepper stages={stages} state={journey} mode={mode} onModeChange={onModeChange} timer={payoutState.status !== "idle"} />
      </div>
    </>
  );
}

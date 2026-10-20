import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWatchContractEvent } from "wagmi";
import { formatEther, type Abi } from "viem";
import { Briefcase, Code, Plus, RotateCcw } from "lucide-react";
import { FlowStepper, type FlowMode } from "./FlowStepper";
import { NextStep } from "./NextStep";
import { PayDrawer } from "./PayDrawer";
import { useFiatFunding } from "../hooks/useFiatFunding";
import { useFlowRun } from "../hooks/useFlowRun";
import { useJobTrace } from "../hooks/useJobTrace";
import { useMyJobs } from "../hooks/useMyJobs";
import { deriveJourney, simulatedPayloads } from "../lib/chainFlow";
import { EUR_PER_ETH, FUNDING_STAGES, ROUTING_STAGE, journeyStages, type PayoutRoute } from "../lib/fiatFlow";
import { STATUS_CLASS, STATUS_LABEL, euro, type Job } from "../lib/jobs";
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mine = useMyJobs();
  useLiveEscrowEvents();

  // Once a new payment lands on-chain, hand over from the live run to that job's own journey.
  const resetLive = useRef<() => void>(() => {});
  const live = useFiatFunding((newId) => {
    setSelectedId(String(newId));
    setTimeout(() => resetLive.current(), 1500);
  });
  useEffect(() => {
    resetLive.current = live.reset;
  });
  const showingLive = live.state.status !== "idle";

  const id = selectedId || routeJobId || String(mine[0]?.id ?? "");
  const selected = mine.find((m) => String(m.id) === id);

  return (
    <div className={page.page}>
      <div className={flow.header}>
        <h2 className={page.title}>Payment flow</h2>
        <button className={styles.button} disabled={live.running} onClick={() => setDrawerOpen(true)}>
          <Plus size={14} /> Pay a milestone
        </button>
        <div className={flow.toggle} role="group" aria-label="View mode">
          <button className={mode === "simple" ? flow.toggleOn : ""} onClick={() => setMode("simple")}>
            <Briefcase size={14} /> Business
          </button>
          <button className={mode === "auditor" ? flow.toggleOn : ""} onClick={() => setMode("auditor")}>
            <Code size={14} /> Auditor
          </button>
        </div>
      </div>

      {drawerOpen && (
        <PayDrawer
          onClose={() => setDrawerOpen(false)}
          onSubmit={(form) => {
            setDrawerOpen(false);
            live.fund(form);
          }}
        />
      )}

      {showingLive ? (
        <section className={page.block}>
          <div className={flow.blockHeader}>
            <h3 className={page.subtitle}>New payment</h3>
            {!live.running && (
              <button className={styles.ghostButton} onClick={live.reset}>
                <RotateCcw size={14} /> Dismiss
              </button>
            )}
          </div>
          <FlowStepper stages={journeyStages("sepa")} state={live.state} mode={mode} timer />
        </section>
      ) : (
        <section className={styles.section}>
          {mine.length > 0 && (
            <select className={styles.input} value={id} onChange={(e) => setSelectedId(e.target.value)}>
              {mine.map(({ id: jid, job }) => (
                <option key={jid} value={jid}>
                  Job #{jid} · {formatEther(job[2])} ETH · {STATUS_LABEL[job[5]]}
                </option>
              ))}
            </select>
          )}
          {selected ? <JobJourney key={selected.id} id={selected.id} job={selected.job} mode={mode} /> : <p className={flow.muted}>No jobs for this account yet. Use "Pay a milestone" to create one.</p>}
        </section>
      )}
    </div>
  );
}

function JobJourney({ id, job, mode }: { id: number; job: Job; mode: FlowMode }) {
  const status = job[5];
  const { data: trace } = useJobTrace(id, status);
  const amountEur = Number(formatEther(job[2])) * EUR_PER_ETH;
  const sim = useMemo(() => simulatedPayloads(FUNDING_STAGES, { jobId: String(id), amountEur }), [id, amountEur]);

  const [route, setRoute] = useState<PayoutRoute>("sepa");
  const payout = useFlowRun(`journey-payout:${id}`);
  const stages = journeyStages(route);
  const journey = deriveJourney(id, job, trace, sim, payout.state, route);

  return (
    <>
      <div className={page.summary}>
        <strong>Job #{id}</strong>
        <span className={`${styles.badge} ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
        <span>{formatEther(job[2])} ETH</span>
        <span className={flow.muted}>≈ {euro(amountEur)}</span>
      </div>

      <NextStep
        id={id}
        job={job}
        payout={{
          state: payout.state,
          route,
          setRoute,
          start: () => payout.start(stages, { jobId: String(id), amountEur, route }, ROUTING_STAGE),
          reset: payout.reset,
          amountEur,
        }}
      />

      <div className={page.block}>
        <FlowStepper stages={stages} state={journey} mode={mode} timer={payout.state.status !== "idle"} />
      </div>
    </>
  );
}

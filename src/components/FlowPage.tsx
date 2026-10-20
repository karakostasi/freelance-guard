import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWatchContractEvent } from "wagmi";
import { formatEther, isAddress, type Abi } from "viem";
import { Briefcase, Code, RotateCcw } from "lucide-react";
import { FlowStepper, type FlowMode } from "./FlowStepper";
import { useFiatFunding } from "../hooks/useFiatFunding";
import { useFlowRun } from "../hooks/useFlowRun";
import { useJobTrace } from "../hooks/useJobTrace";
import { useMyJobs } from "../hooks/useMyJobs";
import { deriveFunding, deriveRelease, simulatedPayloads } from "../lib/chainFlow";
import { EUR_PER_ETH, FUNDING_STAGES, payoutStages, type FlowState, type PayoutRoute } from "../lib/fiatFlow";
import { STATUS_CLASS, STATUS_LABEL, type Job } from "../lib/jobs";
import { escrowAbi, escrowAddress } from "../wagmi";
import styles from "../App.module.css";
import flow from "./FlowStepper.module.css";
import page from "./FlowPage.module.css";

const PAID = 4;

const euro = (n: number) => `€${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Refresh every chain read the moment the escrow emits any event, so the steppers update live. */
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

  const id = selectedId || routeJobId || String(mine[0]?.id ?? "");
  const selected = mine.find((m) => String(m.id) === id);

  return (
    <div className={page.page}>
      <div className={flow.header}>
        <h2 className={page.title}>Payment flow</h2>
        <span className={flow.demo}>Bank steps simulated, escrow steps on-chain</span>
        <div className={flow.toggle} role="group" aria-label="View mode">
          <button className={mode === "simple" ? flow.toggleOn : ""} onClick={() => setMode("simple")}>
            <Briefcase size={14} /> Business
          </button>
          <button className={mode === "auditor" ? flow.toggleOn : ""} onClick={() => setMode("auditor")}>
            <Code size={14} /> Auditor
          </button>
        </div>
      </div>

      <NewPayment mode={mode} onFunded={(newId) => setSelectedId(String(newId))} />

      <section className={styles.section}>
        <div className={flow.blockHeader}>
          <h3 className={page.subtitle}>Track a job</h3>
          {mine.length > 0 && (
            <select className={styles.input} value={id} onChange={(e) => setSelectedId(e.target.value)}>
              {mine.map(({ id: jid, job }) => (
                <option key={jid} value={jid}>
                  Job #{jid} · {formatEther(job[2])} ETH · {STATUS_LABEL[job[5]]}
                </option>
              ))}
            </select>
          )}
        </div>
        {selected ? <JobFlows key={selected.id} id={selected.id} job={selected.job} mode={mode} /> : <p className={flow.muted}>No jobs for this account yet.</p>}
      </section>
    </div>
  );
}

function NewPayment({ mode, onFunded }: { mode: FlowMode; onFunded: (id: number) => void }) {
  const { state, fund, reset, running } = useFiatFunding(onFunded);
  const [freelancer, setFreelancer] = useState("");
  const [amountEth, setAmountEth] = useState("");
  const [days, setDays] = useState("");
  const [description, setDescription] = useState("");

  const valid = isAddress(freelancer) && Number(amountEth) > 0 && Number(days) > 0;
  const eur = Number(amountEth) * EUR_PER_ETH;

  return (
    <section className={styles.section}>
      <h3 className={page.subtitle}>Pay a milestone with euros</h3>
      <div className={page.form}>
        <input className={styles.input} placeholder="Freelancer address (0x…)" value={freelancer} onChange={(e) => setFreelancer(e.target.value)} />
        <div className={styles.suffixField}>
          <input className={styles.input} placeholder="Amount (ETH)" value={amountEth} onChange={(e) => setAmountEth(e.target.value)} />
          <span className={styles.suffix}>{Number(amountEth) > 0 ? `≈ ${euro(eur)}` : "ETH"}</span>
        </div>
        <div className={styles.suffixField}>
          <input className={styles.input} placeholder="Days to deliver" value={days} onChange={(e) => setDays(e.target.value)} />
          <span className={styles.suffix}>days</span>
        </div>
        <input className={styles.input} placeholder="Job description or IPFS link" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className={page.actions}>
        <button
          className={styles.button}
          disabled={!valid || running}
          onClick={() => fund({ freelancer, amountEth, days, description })}
        >
          {Number(amountEth) > 0 ? `Fund Milestone (${euro(eur)})` : "Fund Milestone"}
        </button>
        <span className={flow.muted}>Demo rate: 1 ETH = {euro(EUR_PER_ETH)}. Your wallet signs the real deposit.</span>
      </div>

      {state.status !== "idle" && (
        <div className={page.live}>
          <div className={flow.blockHeader}>
            <h4>Live payment</h4>
            {!running && (
              <button className={styles.ghostButton} onClick={reset} aria-label="Dismiss">
                <RotateCcw size={14} /> Dismiss
              </button>
            )}
          </div>
          <FlowStepper stages={FUNDING_STAGES} state={state} mode={mode} />
        </div>
      )}
    </section>
  );
}

function JobFlows({ id, job, mode }: { id: number; job: Job; mode: FlowMode }) {
  const status = job[5];
  const { data: trace } = useJobTrace(id, status);
  const amountEur = Number(formatEther(job[2])) * EUR_PER_ETH;
  const sim = useMemo(() => simulatedPayloads(FUNDING_STAGES, { jobId: String(id), amountEur }), [id, amountEur]);

  const funding = deriveFunding(id, job, trace, sim);

  const [route, setRoute] = useState<PayoutRoute>("sepa");
  const payout = useFlowRun(`payout:${id}`);
  const stages = payoutStages(route);
  const paid = status === PAID;
  const payoutState: FlowState = { ...payout.state, done: { ...deriveRelease(id, job, trace), ...payout.state.done } };

  return (
    <>
      <div className={page.summary}>
        <strong>Job #{id}</strong>
        <span className={`${styles.badge} ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
        <span>{formatEther(job[2])} ETH</span>
        <span className={flow.muted}>≈ {euro(amountEur)}</span>
      </div>

      <div className={page.block}>
        <h4>Funding</h4>
        <FlowStepper stages={FUNDING_STAGES} state={funding} mode={mode} timer={false} />
      </div>

      <div className={page.block}>
        <div className={flow.blockHeader}>
          <h4>Payout</h4>
          {paid && (
            <>
              <select className={styles.input} value={route} disabled={payout.state.status === "running"} onChange={(e) => setRoute(e.target.value as PayoutRoute)}>
                <option value="sepa">Off-ramp to SEPA</option>
                <option value="eurc">Keep EURC</option>
              </select>
              <button
                className={styles.button}
                disabled={payout.state.status === "running"}
                onClick={() => payout.start(stages, { jobId: String(id), amountEur, route }, 1)}
              >
                {payout.state.status === "done" ? "Run again" : "Route payout"}
              </button>
              {payout.state.status !== "idle" && payout.state.status !== "running" && (
                <button className={styles.ghostButton} onClick={payout.reset} aria-label="Reset">
                  <RotateCcw size={14} />
                </button>
              )}
            </>
          )}
        </div>
        {!paid && <p className={flow.muted}>The release step goes live as soon as the client approves on-chain.</p>}
        <FlowStepper stages={stages} state={payoutState} mode={mode} timer={payout.state.status !== "idle"} />
      </div>
    </>
  );
}

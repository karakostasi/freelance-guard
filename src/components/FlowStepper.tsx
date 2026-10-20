import { useEffect, useState } from "react";
import { Check, Circle, CircleX, Coins, Landmark, LoaderCircle, Route, Send, ShieldCheck, Timer, type LucideIcon } from "lucide-react";
import { stepKey, type FlowState, type Stage } from "../lib/fiatFlow";
import styles from "./FlowStepper.module.css";

export type FlowMode = "simple" | "auditor";

const ICONS: Record<Stage["icon"], LucideIcon> = {
  landmark: Landmark,
  coins: Coins,
  shield: ShieldCheck,
  check: Check,
  route: Route,
  send: Send,
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function useElapsed(state: FlowState) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [state.status]);
  if (!state.startedAt) return 0;
  return (state.finishedAt ?? now) - state.startedAt;
}

export function FlowStepper({ stages, state, mode, timer = true }: { stages: Stage[]; state: FlowState; mode: FlowMode; timer?: boolean }) {
  const elapsed = useElapsed(state);
  const total = stages.reduce((n, s) => n + s.steps.length, 0);
  const completed = Object.keys(state.done).length;

  return (
    <div>
      <div className={styles.meta}>
        <span className={styles.timer}>
          {timer ? (
            <>
              <Timer size={14} /> {state.status === "idle" ? "Not started" : seconds(elapsed)}
            </>
          ) : (
            "Read from chain"
          )}
        </span>
        <span className={styles.muted}>
          {completed}/{total} steps
        </span>
      </div>

      <div className={styles.scroll}>
        <div className={styles.stepper} style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(190px, 1fr))` }}>
          {stages.map((stage, si) => {
            const doneCount = stage.steps.filter((_, i) => state.done[stepKey(si, i)]).length;
            const stageDone = doneCount === stage.steps.length;
            const active = state.status === "running" && state.current?.stage === si;
            const Icon = ICONS[stage.icon];
            return (
              <div key={stage.id} className={styles.column}>
                <div className={`${styles.stage} ${stageDone ? styles.stageDone : ""} ${active ? styles.stageActive : ""}`}>
                  <div className={styles.stageTop}>
                    <Icon size={18} />
                    <strong>
                      {si + 1}. {stage.title}
                    </strong>
                  </div>
                  <div className={styles.bar}>
                    <div className={styles.barFill} style={{ width: `${(doneCount / stage.steps.length) * 100}%` }} />
                  </div>
                  {mode === "simple" && <span className={styles.assurance}>{stageDone ? stage.assurance : active ? "In progress…" : "Waiting"}</span>}
                </div>

                <ul className={styles.steps}>
                  {stage.steps.map((step, i) => {
                    const done = state.done[stepKey(si, i)];
                    const atCurrent = state.current?.stage === si && state.current.step === i && !done;
                    const running = state.status === "running" && atCurrent;
                    const failed = state.status === "error" && atCurrent;
                    return (
                      <li key={step.id} className={`${styles.step} ${done ? styles.stepDone : ""} ${running ? styles.stepRunning : ""} ${failed ? styles.stepFailed : ""}`}>
                        <span className={styles.stepIcon}>
                          {done ? <Check size={14} /> : failed ? <CircleX size={14} /> : running ? <LoaderCircle size={14} className={styles.spin} /> : <Circle size={14} />}
                        </span>
                        <span className={styles.stepBody}>
                          <span>{mode === "simple" ? step.simple : step.label}</span>
                          {mode === "auditor" && done && <AuditDetails payload={done.payload} />}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {state.status === "error" && <p className={styles.errorBanner}>{state.error}</p>}
      {state.status === "done" && mode === "simple" && (
        <p className={styles.banner}>
          <ShieldCheck size={16} /> {stages[stages.length - 1].assurance}
        </p>
      )}
    </div>
  );
}

function AuditDetails({ payload }: { payload: Record<string, unknown> }) {
  const tx = payload.txHash as string | undefined;
  const contract = payload.contract as string | undefined;
  const gas = payload.sponsoredGasEth as string | undefined;
  return (
    <span className={styles.audit}>
      {tx && <span className={styles.mono}>tx {tx.slice(0, 10)}…{tx.slice(-6)}</span>}
      {contract && <span className={styles.mono}>contract {contract.slice(0, 8)}…{contract.slice(-4)}</span>}
      {gas && <span className={styles.mono}>gas sponsored {gas} ETH</span>}
      <details>
        <summary>JSON</summary>
        <pre className={styles.json}>{JSON.stringify(payload, null, 2)}</pre>
      </details>
    </span>
  );
}

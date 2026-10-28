import { useEffect, useState } from "react";
import { Check, Circle, CircleX, Clock, Code, Coins, Eye, Landmark, LoaderCircle, Route, Send, ShieldCheck, Timer, type LucideIcon } from "lucide-react";
import { stepKey, type FlowState, type Stage } from "../lib/fiatFlow";
import styles from "./FlowStepper.module.css";

export type FlowMode = "simple" | "detailed";

const ICONS: Record<Stage["icon"], LucideIcon> = {
  landmark: Landmark,
  coins: Coins,
  shield: ShieldCheck,
  check: Check,
  route: Route,
  send: Send,
};

const EXPLORER = "https://sepolia.basescan.org";

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

/**
 * The journey as a row of boxes grouped by phase, joined by a line that fills as the money moves. The stage in progress
 * glows and is open; any box can be opened or closed with a click. Detailed mode opens them all and shows the technical
 * step names and the data behind each step.
 */
export function FlowStepper({ stages, state, mode, onModeChange, timer = false }: { stages: Stage[]; state: FlowState; mode: FlowMode; onModeChange?: (mode: FlowMode) => void; timer?: boolean }) {
  const elapsed = useElapsed(state);
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const total = stages.reduce((n, s) => n + s.steps.length, 0);
  const completed = Object.keys(state.done).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  // Where each phase starts and how many boxes it spans, for the labels above the row.
  const groups = stages.reduce<{ name: string; start: number; size: number }[]>((acc, stage, index) => {
    const last = acc[acc.length - 1];
    if (last && last.name === stage.group) last.size += 1;
    else acc.push({ name: stage.group, start: index + 1, size: 1 });
    return acc;
  }, []);

  return (
    <div className={styles.stepper}>
      <div className={styles.head}>
        <div className={styles.titles}>
          <h3 className={styles.viewTitle}>Payment steps</h3>
          <p className={styles.viewHint}>
            {mode === "simple" ? "Plain-language steps. The stage in progress is open, click any box to open another." : "Technical step names, transaction hashes and the raw data behind every step."}
          </p>
        </div>
        <div className={styles.progress}>
          <span className={styles.progressText}>
            {timer && state.status !== "idle" && (
              <span className={styles.timer}>
                <Timer size={14} /> {seconds(elapsed)}
              </span>
            )}
            <b>{completed}</b>/{total} steps
          </span>
          <span className={styles.progressBar} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Steps done">
            <span style={{ width: `${percent}%` }} />
          </span>
        </div>
        {onModeChange && (
          <label className={styles.modeSwitch}>
            <span className={styles.modeLabel}>View</span>
            <span className={`${styles.modeName} ${mode === "simple" ? styles.modeOn : ""}`}>
              <Eye size={14} /> Simple
            </span>
            <span className={styles.switch}>
              <input type="checkbox" role="switch" checked={mode === "detailed"} onChange={(e) => onModeChange(e.target.checked ? "detailed" : "simple")} aria-label="Show the detailed view" />
              <span className={styles.switchTrack} />
            </span>
            <span className={`${styles.modeName} ${mode === "detailed" ? styles.modeOn : ""}`}>
              <Code size={14} /> Detailed
            </span>
          </label>
        )}
      </div>
      <div className={styles.legend}>
        <span className={`${styles.tag} ${styles.tagReal}`}>On-chain</span>
        <span className={`${styles.tag} ${styles.tagBackend}`}>Backend</span>
        <span className={`${styles.tag} ${styles.tagSandbox}`}>Sandbox</span>
        <span className={`${styles.tag} ${styles.tagDemo}`}>Demo</span>
      </div>

      <div className={styles.scroll}>
        <div className={styles.journey} style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(116px, 1fr))`, minWidth: `${stages.length * 130}px` }}>
          {groups.map((group) => (
            <div key={`${group.name}-${group.start}`} className={`${styles.groupLabel} ${styles[`group${group.name}`] ?? ""}`} style={{ gridColumn: `${group.start} / span ${group.size}` }}>
              {group.name}
            </div>
          ))}
          {stages.map((stage, si) => {
            const doneCount = stage.steps.filter((_, i) => state.done[stepKey(si, i)]).length;
            const stageDone = doneCount === stage.steps.length;
            const active = state.current?.stage === si && state.status !== "done";
            const failed = active && state.status === "error";
            const locked = !stageDone && !active && doneCount === 0;
            const expanded = toggled[si] ?? (active || mode === "detailed");
            const Icon = ICONS[stage.icon];
            const status = stageDone ? (mode === "simple" ? stage.assurance : "Done") : active ? (state.waiting ? "Up next" : "In progress") : doneCount > 0 ? "Partly done" : "Locked";
            const kind = failed ? styles.boxFailed : stageDone ? styles.boxDone : active ? styles.boxActive : locked ? styles.boxLocked : "";
            return (
              <div key={stage.id} className={`${styles.column} ${stageDone ? styles.columnDone : ""} ${active ? styles.columnActive : ""}`}>
                <button className={`${styles.box} ${kind}`} onClick={() => setToggled((t) => ({ ...t, [si]: !expanded }))} aria-expanded={expanded} aria-label={`${stage.title}: ${stageDone ? "done" : active ? "in progress" : "not started"}`}>
                  <span className={styles.icon}>
                    <Icon size={20} />
                    {stageDone && (
                      <span className={styles.tick}>
                        <Check size={10} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className={styles.boxTitle}>{stage.title}</span>
                  <span className={styles.boxStatus}>{status}</span>
                  <span className={styles.progressRow} title={`${doneCount} of ${stage.steps.length} steps done`}>
                    <span className={styles.dots} aria-hidden="true">
                      {stage.steps.map((step, i) => (
                        <i key={step.id} className={state.done[stepKey(si, i)] ? styles.dotOn : active && state.current?.step === i ? styles.dotRun : ""} />
                      ))}
                    </span>
                    <span className={styles.dotsText}>
                      {doneCount}/{stage.steps.length} steps
                    </span>
                  </span>
                </button>

                {expanded && (
                  <ul className={styles.steps}>
                    {stage.steps.map((step, i) => {
                      const done = state.done[stepKey(si, i)];
                      const atCurrent = state.current?.stage === si && state.current.step === i && !done;
                      const running = state.status === "running" && atCurrent && !state.waiting;
                      const waiting = state.status === "running" && atCurrent && state.waiting;
                      const stepFailed = state.status === "error" && atCurrent;
                      return (
                        <li key={step.id} className={`${styles.step} ${done ? styles.stepDone : ""} ${running || waiting ? styles.stepRunning : ""} ${stepFailed ? styles.stepFailed : ""}`}>
                          <span className={styles.stepIcon}>
                            {done ? <Check size={14} /> : stepFailed ? <CircleX size={14} /> : running ? <LoaderCircle size={14} className={styles.spin} /> : waiting ? <Clock size={14} /> : <Circle size={14} />}
                          </span>
                          <span className={styles.stepBody}>
                            <span>{mode === "simple" ? step.simple : step.label}</span>
                            <StepTag real={!!step.real} source={done?.payload.source as string | undefined} txHash={done?.payload.txHash as string | undefined} />
                            {mode === "detailed" && done && <AuditDetails payload={done.payload} />}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {state.status === "error" && <p className={styles.errorBanner}>{state.error}</p>}
      {state.status === "done" && mode === "simple" && !state.waiting && state.current === undefined && completed === total && (
        <p className={styles.banner}>
          <ShieldCheck size={16} /> {stages[stages.length - 1].assurance}
        </p>
      )}
    </div>
  );
}

function StepTag({ real, source, txHash }: { real: boolean; source?: string; txHash?: string }) {
  if (!real && source === "backend") return <span className={`${styles.tag} ${styles.tagBackend}`}>Backend</span>;
  if (!real && source === "sandbox") return <span className={`${styles.tag} ${styles.tagSandbox}`}>Sandbox</span>;
  if (!real) return <span className={`${styles.tag} ${styles.tagDemo}`}>Demo</span>;
  return txHash ? (
    <a className={`${styles.tag} ${styles.tagReal}`} href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
      On-chain ↗
    </a>
  ) : (
    <span className={`${styles.tag} ${styles.tagReal}`}>On-chain</span>
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

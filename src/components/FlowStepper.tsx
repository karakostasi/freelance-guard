import { useEffect, useState } from "react";
import { Check, ChevronDown, Circle, CircleX, Clock, Code, Coins, Eye, Landmark, LoaderCircle, Route, Send, ShieldCheck, Timer, type LucideIcon } from "lucide-react";
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
 * Horizontal journey: stage boxes in one row grouped by phase. Only the active stage shows its
 * sub-steps (all of them in Detailed mode); any stage can be expanded or collapsed by clicking it.
 */
export function FlowStepper({ stages, state, mode, onModeChange, timer = false }: { stages: Stage[]; state: FlowState; mode: FlowMode; onModeChange?: (mode: FlowMode) => void; timer?: boolean }) {
  const elapsed = useElapsed(state);
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const total = stages.reduce((n, s) => n + s.steps.length, 0);
  const completed = Object.keys(state.done).length;

  const groups = stages.reduce<{ name: string; items: { stage: Stage; index: number }[] }[]>((acc, stage, index) => {
    const last = acc[acc.length - 1];
    if (last && last.name === stage.group) last.items.push({ stage, index });
    else acc.push({ name: stage.group, items: [{ stage, index }] });
    return acc;
  }, []);

  return (
    <div>
      {onModeChange && (
        <div className={styles.viewBar}>
          <div>
            <h3 className={styles.viewTitle}>Payment steps</h3>
            <p className={styles.viewHint}>
              {mode === "simple" ? "Simple: plain-language steps, one stage open at a time." : "Detailed: technical step names, transaction hashes and the raw data behind every step."}
            </p>
          </div>
          <div className={styles.toggle} role="group" aria-label="How much detail to show">
            <button className={mode === "simple" ? styles.toggleOn : ""} onClick={() => onModeChange("simple")} aria-pressed={mode === "simple"}>
              <Eye size={14} /> Simple
            </button>
            <button className={mode === "detailed" ? styles.toggleOn : ""} onClick={() => onModeChange("detailed")} aria-pressed={mode === "detailed"}>
              <Code size={14} /> Detailed
            </button>
          </div>
        </div>
      )}
      <div className={styles.meta}>
        <span className={styles.legend}>
          <span className={`${styles.tag} ${styles.tagReal}`}>On-chain</span>
          <span className={`${styles.tag} ${styles.tagBackend}`}>Backend</span>
          <span className={`${styles.tag} ${styles.tagSandbox}`}>Sandbox</span>
          <span className={`${styles.tag} ${styles.tagDemo}`}>Demo</span>
        </span>
        <span className={styles.muted}>
          {timer && state.status !== "idle" && (
            <span className={styles.timer}>
              <Timer size={14} /> {seconds(elapsed)}
            </span>
          )}{" "}
          {completed}/{total} steps
        </span>
      </div>

      <div className={styles.scroll}>
        <div className={styles.journey}>
          {groups.map((group) => (
            <div key={group.name} className={styles.group} style={{ flex: group.items.length }}>
              <div className={styles.groupLabel}>{group.name}</div>
              <div className={styles.groupStages} style={{ gridTemplateColumns: `repeat(${group.items.length}, minmax(120px, 1fr))` }}>
                {group.items.map(({ stage, index: si }) => {
                  const doneCount = stage.steps.filter((_, i) => state.done[stepKey(si, i)]).length;
                  const stageDone = doneCount === stage.steps.length;
                  const active = state.current?.stage === si && state.status !== "done";
                  const failed = active && state.status === "error";
                  const expanded = toggled[si] ?? (active || mode === "detailed");
                  const Icon = ICONS[stage.icon];
                  const status = stageDone ? "Done" : active ? (state.waiting ? "Up next" : "In progress") : doneCount > 0 ? `${doneCount}/${stage.steps.length}` : "Locked";
                  return (
                    <div key={stage.id} className={styles.column}>
                      <button
                        className={`${styles.stage} ${stageDone ? styles.stageDone : ""} ${active ? styles.stageActive : ""} ${failed ? styles.stageFailed : ""} ${!stageDone && !active && doneCount === 0 ? styles.stageLocked : ""}`}
                        onClick={() => setToggled((t) => ({ ...t, [si]: !expanded }))}
                        aria-expanded={expanded}
                      >
                        <span className={styles.stageTop}>
                          <Icon size={16} />
                          <strong>{stage.title}</strong>
                          <ChevronDown size={14} className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`} />
                        </span>
                        <span className={styles.bar}>
                          <span className={styles.barFill} style={{ width: `${(doneCount / stage.steps.length) * 100}%` }} />
                        </span>
                        <span className={styles.assurance}>{mode === "simple" && stageDone ? stage.assurance : status}</span>
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
          ))}
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

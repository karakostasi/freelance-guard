import { useCallback, useEffect, useReducer, useRef } from "react";
import { flowReducer, initialFlowState, runFlow, type FlowContext, type FlowEvent, type FlowState, type Stage } from "../lib/fiatFlow";

const storageKey = (key: string) => `fg-flow:${key}`;

const load = (key: string): FlowState => {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return initialFlowState;
    const saved = JSON.parse(raw) as FlowState;
    // A run that was mid-flight when the page closed can't continue; show it as not started.
    return saved.status === "running" ? initialFlowState : saved;
  } catch {
    return initialFlowState;
  }
};

/**
 * State of one simulated flow run. The state is mirrored to localStorage, and the
 * `storage` event pushes it to other open tabs, standing in for a WebSocket state sync.
 */
export function useFlowRun(key: string) {
  const [state, dispatch] = useReducer(flowReducer, key, load);
  const cancel = useRef<(() => void) | null>(null);
  const latest = useRef(state);

  useEffect(() => {
    latest.current = state;
    localStorage.setItem(storageKey(key), JSON.stringify(state));
  }, [key, state]);

  // Remote tab updates -> replay the saved state locally.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(key) || !e.newValue) return;
      const remote = JSON.parse(e.newValue) as FlowState;
      if (JSON.stringify(remote) === JSON.stringify(latest.current)) return;
      dispatch({ type: "reset" });
      if (remote.startedAt) dispatch({ type: "start", at: remote.startedAt });
      for (const [k, v] of Object.entries(remote.done)) {
        const [stage, step] = k.split(".").map(Number);
        dispatch({ type: "step_done", stage, step, at: v.at, payload: v.payload });
      }
      if (remote.current) dispatch({ type: "step_start", ...remote.current, at: Date.now() });
      if (remote.status === "done" && remote.finishedAt) dispatch({ type: "done", at: remote.finishedAt });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  useEffect(() => () => cancel.current?.(), []);

  const start = useCallback((stages: Stage[], ctx: FlowContext, fromStage = 0) => {
    cancel.current?.();
    cancel.current = runFlow(stages, ctx, (ev: FlowEvent) => dispatch(ev), fromStage);
  }, []);

  const reset = useCallback(() => {
    cancel.current?.();
    dispatch({ type: "reset" });
  }, []);

  return { state, start, reset, emit: dispatch };
}

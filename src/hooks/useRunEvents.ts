import { useEffect, useMemo, useState } from "react";
import { API_URL, type ServerEvent } from "../lib/api";
import { flowReducer, initialFlowState, stepIndex, type FlowEvent, type FlowState } from "../lib/fiatFlow";

export function toFlowState(events: ServerEvent[]): FlowState {
  return events.reduce<FlowState>((state, ev) => {
    const at = ev.at;
    let flowEvent: FlowEvent | null = null;
    if (ev.type === "start") flowEvent = { type: "start", at };
    else if (ev.type === "done") flowEvent = { type: "done", at };
    else if (ev.type === "error") flowEvent = { type: "error", message: ev.message ?? "Payment failed" };
    else if ((ev.type === "step_start" || ev.type === "step_done") && ev.stage && ev.step) {
      const idx = stepIndex(ev.stage, ev.step);
      if (idx) flowEvent = ev.type === "step_start" ? { type: "step_start", ...idx, at } : { type: "step_done", ...idx, at, payload: ev.payload ?? {} };
    }
    return flowEvent ? flowReducer(state, flowEvent) : state;
  }, initialFlowState);
}

/** Live event stream of one backend payment run (history first, then new events as they happen). */
export function useRunEvents(runId: string | null) {
  const [store, setStore] = useState<{ runId: string | null; events: ServerEvent[] }>({ runId: null, events: [] });

  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`${API_URL}/api/payments/${runId}/events`);
    source.onmessage = (m) => {
      const ev = JSON.parse(m.data) as ServerEvent;
      setStore((prev) => {
        const events = prev.runId === runId ? prev.events : [];
        return events.some((e) => e.seq === ev.seq) ? prev : { runId, events: [...events, ev] };
      });
    };
    return () => source.close();
  }, [runId]);

  const events = useMemo(() => (store.runId === runId ? store.events : []), [store, runId]);
  const state = useMemo(() => toFlowState(events), [events]);
  return { events, state };
}

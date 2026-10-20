import { useAccount } from "wagmi";
import { RotateCcw } from "lucide-react";
import { JobActions } from "./JobActions";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import { STATUS, STATUS_CLASS, euro, formatDuration, type Job } from "../lib/jobs";
import type { FlowState, PayoutRoute } from "../lib/fiatFlow";
import styles from "../App.module.css";
import page from "./FlowPage.module.css";

export type PayoutControls = {
  state: FlowState;
  route: PayoutRoute;
  setRoute: (r: PayoutRoute) => void;
  start: () => void;
  reset: () => void;
  amountEur: number;
  /** Payout is run by the backend, so there is nothing to click. */
  auto?: boolean;
};

/** Plain-language "what happens next" for a job, with the real action buttons for whoever has to act. */
export function NextStep({ id, job, payout }: { id: number; job: Job; payout: PayoutControls }) {
  const { address } = useAccount();
  const { reviewPeriod, arbiter } = useEscrowConfig();
  const now = useNow();

  const me = address?.toLowerCase();
  const isClient = me === job[0].toLowerCase();
  const isFreelancer = me === job[1].toLowerCase();
  const isArbiter = !!me && arbiter?.toLowerCase() === me;
  const status = STATUS[job[5]];

  const deadline = job[3];
  const reviewEnd = reviewPeriod !== undefined ? job[4] + reviewPeriod : undefined;
  const left = (to: bigint) => (now >= to ? "ended" : `in ${formatDuration(to - now)}`);

  let title = "";
  let detail = "";
  if (status === "Funded") {
    title = isFreelancer ? "Your turn: deliver the work" : "Waiting for the freelancer to deliver";
    detail = now > deadline ? (isClient ? "The deadline passed. You can take a refund." : "The deadline passed.") : `Due ${left(deadline)}.`;
  } else if (status === "Submitted") {
    title = isClient ? "Your turn: review the work" : "Waiting for the client's review";
    detail = reviewEnd === undefined ? "" : isFreelancer && now >= reviewEnd ? "The review period ended. You can claim your payment." : `Review period ${left(reviewEnd)}.`;
  } else if (status === "Disputed") {
    title = isArbiter ? "Your turn: resolve the dispute" : "Waiting for the arbiter";
    detail = "The client contested the work.";
  } else if (status === "Paid") {
    const s = payout.state.status;
    title = s === "done" ? "All done" : s === "running" ? "Routing the payout…" : payout.auto ? "Payment released. The payout starts automatically" : "Payment released. Choose where the money goes";
    detail =
      s === "done"
        ? `${euro(payout.amountEur)} ${payout.route === "eurc" ? "kept as EURC in the wallet" : "sent to the bank account via SEPA Instant"}.`
        : "The escrow released the funds to the freelancer.";
  } else if (status === "Refunded") {
    title = "Refunded";
    detail = "The funds went back to the client.";
  }

  return (
    <div className={`${page.next} ${STATUS_CLASS[job[5]]}`}>
      <div>
        <strong>{title}</strong>
        {detail && <p className={styles.muted}>{detail}</p>}
      </div>
      <div className={page.nextActions}>
        {status === "Paid" && payout.auto ? (
          <span className={styles.muted}>Route: {payout.route === "eurc" ? "keep EURC" : "SEPA bank transfer"}</span>
        ) : status === "Paid" ? (
          <>
            <select className={styles.input} value={payout.route} disabled={payout.state.status === "running"} onChange={(e) => payout.setRoute(e.target.value as PayoutRoute)}>
              <option value="sepa">Off-ramp to SEPA</option>
              <option value="eurc">Keep EURC</option>
            </select>
            <button className={styles.button} disabled={payout.state.status === "running"} onClick={payout.start}>
              {payout.state.status === "done" ? "Run again" : "Route payout"}
            </button>
            {payout.state.status !== "idle" && payout.state.status !== "running" && (
              <button className={styles.ghostButton} onClick={payout.reset} aria-label="Reset payout">
                <RotateCcw size={14} />
              </button>
            )}
          </>
        ) : (
          <JobActions id={String(id)} job={job} />
        )}
      </div>
    </div>
  );
}

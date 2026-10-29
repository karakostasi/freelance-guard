import { useState } from "react";
import { useAccount } from "wagmi";
import { RotateCcw } from "lucide-react";
import { JobActions } from "./JobActions";
import { PayoutSettings } from "./PayoutSettings";
import { describePayout, usePayoutOf } from "../hooks/usePayoutOf";
import { DeliverableView } from "./DocView";
import { useDoc } from "../hooks/useDoc";
import { useEscrowConfig } from "../hooks/useEscrowConfig";
import { useNow } from "../hooks/useNow";
import { parseDescription, receiptPath } from "../lib/documents";
import { STATUS, amountFor, euro, formatDay, formatDuration, hasVerifier, milestoneName, type Job } from "../lib/jobs";
import { formatAmount } from "../lib/tokens";
import type { FlowState, PayoutRoute } from "../lib/fiatFlow";
import styles from "../App.module.css";
import s from "./NextStep.module.css";

export type PayoutControls = {
  state: FlowState;
  route: PayoutRoute;
  setRoute: (r: PayoutRoute) => void;
  start: () => void;
  reset: () => void;
  amountEur: number;
  /** Payout is run by the backend, so there is nothing to click. */
  auto?: boolean;
  /** The payee has chosen how they are paid, so the route is not for anyone to pick here. */
  fixed?: boolean;
};

type Tone = "action" | "wait" | "done";

/**
 * The one thing to do next on a job, in a sentence, with the button for whoever has to act. Everything else about the
 * milestone (dispute, refund, the facts and the transactions) is below it. On the payment flow page `payout` adds the
 * payout routing to a paid milestone.
 */
export function NextStep({ id, index, job, payout }: { id: number; index: number; job: Job; payout?: PayoutControls }) {
  const { address } = useAccount();
  const { reviewPeriod, arbiter } = useEscrowConfig();
  const now = useNow();
  const { ref } = parseDescription(job.description);
  const { data: doc } = useDoc(ref);
  const payoutPref = usePayoutOf(job.payee);
  const [choosing, setChoosing] = useState(false);

  const me = address?.toLowerCase();
  const ms = job.milestones[index];
  const isPayer = me === job.payer.toLowerCase();
  const isPayee = me === job.payee.toLowerCase();
  const isVerifier = !!me && hasVerifier(job) && me === job.verifier.toLowerCase();
  const isArbiter = !!me && arbiter?.toLowerCase() === me;
  const status = STATUS[ms.status];
  const name = milestoneName(job, index);
  const the = name ? `the ${name}` : "";
  // The business names the payer typed in, when there are any. Otherwise just the role.
  const payeeName = doc?.billing?.payeeName || "The payee";
  const payerName = doc?.billing?.payerName || "The payer";

  const deadline = ms.deadline;
  const reviewEnd = reviewPeriod !== undefined ? ms.submittedAt + reviewPeriod : undefined;
  const left = (to: bigint) => (now >= to ? "ended" : `in ${formatDuration(to - now)}`);
  const gross = formatAmount(job, ms.amount);
  const net = formatAmount(job, amountFor(job, ms, job.payee));
  const next = job.milestones.findIndex((m, i) => i > index && m.status < 4);
  const nextText = next >= 0 ? ` Next up is ${job.milestones[next].title.trim().toLowerCase() || `stage ${next + 1}`}.` : "";

  let tone: Tone = "wait";
  let eyebrow = "";
  let title = "";
  let detail = "";
  let showDeliverable = false;
  if (status === "Unfunded") {
    tone = isPayer ? "action" : "wait";
    eyebrow = isPayer ? "Your turn" : `Waiting for ${payerName.toLowerCase()}`;
    title = isPayer ? `Fund ${the || "this payment"}` : `${payerName} still has to fund ${the || "this payment"}`;
    detail = isPayer ? "The payee's clock starts once it is funded." : "You can start once it is funded.";
  } else if (status === "Funded") {
    const late = now > deadline;
    if (isPayee) {
      tone = "action";
      eyebrow = "Your turn";
      title = late ? `Deliver ${the || "the work"} now` : `Deliver ${the || "the work"} by ${formatDay(deadline)}`;
      detail = `${gross} is held for you. After the platform fee, you receive ${net}.${late ? " The deadline passed, so the payer can take the money back." : ""}`;
    } else if (isPayer && late) {
      tone = "action";
      eyebrow = "Your turn";
      title = "The deadline passed";
      detail = `${payeeName} did not deliver ${the || "the work"} in time. You can take your money back.`;
    } else {
      eyebrow = `Waiting for ${payeeName.toLowerCase()}`;
      title = `${payeeName} is working on ${the || "the job"}`;
      detail = `Due ${formatDay(deadline)}, ${left(deadline)}. ${gross} is held safely${isPayer ? " and goes to the payee only when you approve. If nothing arrives in time, you can take it back." : "."}`;
    }
  } else if (status === "Submitted") {
    showDeliverable = true;
    if (isPayer || isVerifier) {
      tone = "action";
      eyebrow = "Your turn";
      title = `${payeeName} delivered ${the || "the work"}. Take a look.`;
      detail = reviewEnd === undefined ? "" : now >= reviewEnd ? "The review period ended. The payee can claim the payment now, but you can still approve it." : `You have until ${formatDay(reviewEnd)}. After that, the payee can claim the payment.`;
    } else {
      eyebrow = `Waiting for ${payerName.toLowerCase()}`;
      title = isPayee ? "Your delivery is with the payer" : `${payerName} is reviewing ${the || "the work"}`;
      detail = reviewEnd === undefined ? "" : now >= reviewEnd ? (isPayee ? `The review period ended. You can claim your ${net} now.` : "The review period ended.") : `They have until ${formatDay(reviewEnd)} to approve or report a problem.${isPayee ? ` You then receive ${net}.` : ""}`;
    }
  } else if (status === "Disputed") {
    tone = isArbiter ? "action" : "wait";
    eyebrow = isArbiter ? "Your turn" : "With the arbiter";
    title = isArbiter ? "Resolve the dispute" : isPayer ? "You reported a problem" : "The payer reported a problem";
    detail = isArbiter ? "The payer contested the work. Decide who gets the money." : `The ${gross} stays locked. An arbiter looks at both sides and decides who gets the money.`;
  } else if (status === "Paid") {
    tone = "done";
    const routing = payout?.state.status;
    eyebrow = routing === "done" ? "All done" : "Paid";
    title = isPayee ? `You received ${net}` : payout ? (routing === "done" ? "All done" : routing === "running" ? "Routing the payout…" : "Payment released") : `${name ? `The ${name}` : "The payment"} is paid`;
    detail =
      payout && routing === "done"
        ? `${euro(payout.amountEur)} ${payout.route === "eurc" ? "kept as a stablecoin in the wallet" : payout.route === "ach" ? "sent to the US bank account by ACH" : "sent to the bank account via SEPA Instant"}.`
        : `The escrow released ${gross} to the payee.${nextText}`;
  } else if (status === "Refunded") {
    tone = "wait";
    eyebrow = "Refunded";
    title = "The money went back to the payer";
    detail = `${gross} was returned.${nextText}`;
  }

  const paidActions = status === "Paid" && (
    <div className={s.actions}>
      {payout?.auto ? (
        <span className={styles.muted}>Route: {payout.route === "eurc" ? "keep the stablecoin" : payout.route === "ach" ? "ACH bank transfer in dollars" : "SEPA bank transfer"}</span>
      ) : payout ? (
        <>
          {payout.fixed ? (
            <span className={styles.muted}>Route chosen by the payee: {payout.route === "eurc" ? "keep the stablecoin" : payout.route === "ach" ? "ACH bank transfer in dollars" : "SEPA bank transfer"}</span>
          ) : (
            <select className={styles.input} value={payout.route} disabled={payout.state.status === "running"} onChange={(e) => payout.setRoute(e.target.value as PayoutRoute)} aria-label="Where the payout goes">
              <option value="sepa">Off-ramp to SEPA</option>
              <option value="ach">Off-ramp to a US account (ACH)</option>
              <option value="eurc">Keep the stablecoin</option>
            </select>
          )}
          <button className={styles.button} disabled={payout.state.status === "running"} onClick={payout.start}>
            {payout.state.status === "done" ? "Run again" : "Route payout"}
          </button>
          {payout.state.status !== "idle" && payout.state.status !== "running" && (
            <button className={styles.ghostButton} onClick={payout.reset} aria-label="Reset payout">
              <RotateCcw size={14} />
            </button>
          )}
        </>
      ) : null}
      <a className={styles.chipButton} href={`#${receiptPath(id, index)}`}>
        View the receipt
      </a>
    </div>
  );

  return (
    <section className={`${s.card} ${s[tone]}`} aria-label="Next step">
      <span className={s.eyebrow}>{eyebrow}</span>
      <h2 className={s.title}>{title}</h2>
      {showDeliverable && ms.deliverable && (
        <div className={s.deliverable}>
          <DeliverableView value={ms.deliverable} />
        </div>
      )}
      {detail && <p className={s.detail}>{detail}</p>}
      {status === "Paid" || status === "Refunded" ? paidActions : <JobActions id={String(id)} index={index} job={job} />}
      {/* The payee decides where the money goes, and can change it until the payment is released. */}
      {(status === "Unfunded" || status === "Funded" || status === "Submitted" || status === "Disputed") && (isPayee || isPayer) && (
        <p className={s.payout}>
          {payoutPref.data?.route ? (
            <>
              {isPayee ? "You get paid in" : "The payee gets paid in"} {describePayout(payoutPref.data)}.
            </>
          ) : isPayee ? (
            "Choose how you want to be paid: a bank account, or the stablecoin in your wallet."
          ) : (
            "The payee hasn't chosen yet how they get paid."
          )}{" "}
          {isPayee && (
            <button type="button" className={styles.textButton} onClick={() => setChoosing(true)}>
              {payoutPref.data?.route ? "Change" : "Choose"}
            </button>
          )}
        </p>
      )}
      {choosing && <PayoutSettings onClose={() => setChoosing(false)} />}
    </section>
  );
}

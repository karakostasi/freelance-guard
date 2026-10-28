import { useEffect, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { useReadContract } from "wagmi";
import { escrowAbi, escrowAddress } from "../wagmi";
import { useDoc } from "../hooks/useDoc";
import { useJobTrace } from "../hooks/useJobTrace";
import { jobTitle, parseDescription, receiptNumber } from "../lib/documents";
import { NETWORK_LABEL, addressUrl, jobFromChain, milestoneFee, paidOutcome, txUrl, type RawJob } from "../lib/jobs";
import { formatAmount } from "../lib/tokens";
import logo from "../assets/logo.svg";
import styles from "../App.module.css";
import r from "./Receipt.module.css";

const PAID = 4;

const positive = (value: string | undefined) => (value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined);

function Message({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className={r.message}>
      <h2>{title}</h2>
      {detail && <p className={styles.muted}>{detail}</p>}
      <a href="#/jobs">Back to jobs</a>
    </div>
  );
}

function Party({ label, name, vatId, address }: { label: string; name?: string; vatId?: string; address: string }) {
  return (
    <div className={r.party}>
      <span className={r.label}>{label}</span>
      {name && <span className={r.partyName}>{name}</span>}
      {vatId && <span>VAT {vatId}</span>}
      <a className={r.wallet} href={addressUrl(address)} target="_blank" rel="noreferrer noopener">
        {address}
      </a>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

/**
 * The receipt for one paid milestone, at "#/receipt/<job>/<milestone>". It is built from the chain and the job's
 * document, so anyone with the link sees the same thing, with no wallet needed. The browser prints it or saves it as a PDF.
 */
export function ReceiptPage({ jobId, milestone }: { jobId?: string; milestone?: string }) {
  const id = positive(jobId);
  const number = positive(milestone);
  const index = number === undefined ? undefined : number - 1;

  const { data, isLoading, error } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "getJob", args: [BigInt(id ?? 0)], query: { enabled: id !== undefined } });
  const job = data ? jobFromChain(data as RawJob) : undefined;
  const ms = job && index !== undefined ? job.milestones[index] : undefined;
  const { data: trace, isFetching } = useJobTrace(id, index, ms);
  const { ref } = parseDescription(job?.description ?? "");
  const { data: doc, isLoading: docLoading, error: docError } = useDoc(ref);

  // The page title becomes the file name suggested when saving as a PDF.
  const receiptNo = id !== undefined && index !== undefined ? receiptNumber(id, index) : undefined;
  useEffect(() => {
    if (!receiptNo) return;
    const before = document.title;
    document.title = `Receipt ${receiptNo} · Squirrel`;
    return () => {
      document.title = before;
    };
  }, [receiptNo]);

  if (id === undefined || number === undefined || index === undefined) return <Message title="This receipt link isn't valid." />;
  if (isLoading) return <Message title="Loading the receipt…" />;
  if (error) return <Message title="Couldn't read the job." detail={error.message.split("\n")[0]} />;
  if (!job || job.milestones.length === 0) return <Message title={`Job #${id} doesn't exist.`} />;
  if (!ms) return <Message title={`Job #${id} has no milestone ${number}.`} />;
  if (ms.status !== PAID) return <Message title="No receipt yet." detail={`Milestone ${number} of job #${id} hasn't been paid. A receipt is issued once its payment is released.`} />;

  const released = trace?.released;
  const paidOn = released ? new Date(released.blockTime * 1000).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "long" }) : isFetching ? "Looking up the payment…" : "Not available";
  const billing = doc?.billing;
  const multi = job.milestones.length > 1;
  const fee = milestoneFee(job, ms);

  return (
    <>
      <article className={r.paper}>
        <header className={r.head}>
          <span className={r.brand}>
            <img src={logo} alt="" /> Squirrel
          </span>
          <div>
            <h2 className={r.title}>Payment receipt</h2>
            <span className={r.number}>{receiptNo}</span>
          </div>
        </header>

        <div className={r.amount}>
          <span className={r.label}>Amount</span>
          <span className={r.amountValue}>{formatAmount(job, ms.amount)}</span>
        </div>

        <dl className={r.facts}>
          <Row label="Paid on">{paidOn}</Row>
          <Row label="Job">
            {jobTitle(job.description, id)} <span className={r.jobNo}>Job #{id}</span>
          </Row>
          {multi && (
            <Row label="Milestone">
              {number} of {job.milestones.length}: {ms.title || "Untitled"}
            </Row>
          )}
          <Row label="Platform fee">{formatAmount(job, fee)} (paid by the payee, out of this payment)</Row>
          <Row label="Received by the payee">{formatAmount(job, ms.amount - fee)}</Row>
          {billing?.reference && <Row label="Reference">{billing.reference}</Row>}
          <Row label="Released">{paidOutcome(job, released?.kind, released?.from.toLowerCase())}</Row>
        </dl>

        <section className={r.parties}>
          <Party label="From (payer)" name={billing?.payerName} vatId={billing?.payerVatId} address={job.payer} />
          <Party label="To (payee)" name={billing?.payeeName} vatId={billing?.payeeVatId} address={job.payee} />
        </section>

        <dl className={r.proof}>
          <Row label="Transaction">
            {released ? (
              <a className={r.mono} href={txUrl(released.txHash)} target="_blank" rel="noreferrer noopener">
                {released.txHash}
              </a>
            ) : (
              <span>{isFetching ? "Looking up the payment…" : "Not found"}</span>
            )}
          </Row>
          <Row label="Network">{NETWORK_LABEL}</Row>
          <Row label="Escrow contract">
            <a className={r.mono} href={addressUrl(escrowAddress)} target="_blank" rel="noreferrer noopener">
              {escrowAddress}
            </a>
          </Row>
          {ref && (
            <Row label="Job details (SHA-256)">
              <span className={r.mono}>{ref}</span>
            </Row>
          )}
        </dl>

        <p className={r.note}>
          This receipt records a payment released from escrow on {NETWORK_LABEL}. It is a record of payment, not a tax invoice.
          {billing && " The reference, company names and VAT IDs were entered by the payer when the job was created. Squirrel has not verified them."}
          {ref && !doc && !docLoading && docError && " The job's details document could not be loaded, so any reference and company details are missing from this copy."}
        </p>
      </article>

      <div className={`${r.actions} ${styles.noPrint}`}>
        <button className={styles.button} onClick={() => window.print()}>
          <Printer size={15} style={{ verticalAlign: "-2px" }} /> Print or save as PDF
        </button>
        <a className={styles.chipButton} href={`#/flow/${id}`}>
          View the job
        </a>
      </div>
    </>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { erc20Abi, formatUnits, isAddress, parseEventLogs, parseUnits, zeroAddress, type Abi } from "viem";
import { Check, Lock, Plus, X } from "lucide-react";
import { escrowAbi, escrowAddress } from "../wagmi";
import { useBackendStatus } from "../hooks/useBackend";
import { useQuote, useTokenConfig } from "../hooks/useQuote";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { navigate } from "../hooks/useHashRoute";
import { BILLING_MAX, buildDescription, cleanBilling, type Billing } from "../lib/documents";
import { ensureAllowance } from "../lib/erc20";
import { surchargeOn } from "../lib/fees";
import { uploadDoc, uploadFile } from "../lib/files";
import { setPendingPayment } from "../lib/pendingPayment";
import { euro } from "../lib/jobs";
import { ETH, TOKENS, formatBalance, formatUnitsOf, toEur } from "../lib/tokens";
import type { PayoutRoute } from "../lib/fiatFlow";
import { FileDrop } from "./FileDrop";
import { ReputationBadge } from "./ReputationBadge";
import { WalletCard } from "./WalletCard";
import styles from "../App.module.css";
import n from "./NewJob.module.css";

type Row = { title: string; percent: string; days: string };
type PayWith = "wallet" | "bank";

const PRESETS: { label: string; rows: Row[] }[] = [
  { label: "1 payment", rows: [{ title: "Delivery", percent: "100", days: "7" }] },
  {
    label: "50 / 50",
    rows: [
      { title: "Upfront", percent: "50", days: "3" },
      { title: "Delivery", percent: "50", days: "14" },
    ],
  },
  {
    label: "30 / 40 / 30",
    rows: [
      { title: "Upfront", percent: "30", days: "3" },
      { title: "Draft", percent: "40", days: "10" },
      { title: "Delivery", percent: "30", days: "20" },
    ],
  },
];

const STEPS = ["Who and how much", "Payment stages", "Review and pay"];
const MAX_MILESTONES = 20;
const MAX_TITLE = 80;
// Short specs are written on-chain as they are. Longer ones, and anything with files, become a stored document.
const INLINE_SPEC_MAX = 280;
const DAY = 86400;

const sameRows = (a: Row[], b: Row[]) => a.length === b.length && a.every((r, i) => r.title === b[i].title && r.percent === b[i].percent && r.days === b[i].days);

/**
 * The page for creating a job, in three steps: who and how much, the payment stages, and a review. The payer pays
 * either from their wallet (an on-chain transaction right here) or by bank transfer in euros, which hands over to the
 * live payment flow. Whatever stops a step from going on is said in words under its button.
 */
export function NewJobPage() {
  const { address } = useAccount();
  const { online: backendOnline } = useBackendStatus();
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState(1);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [working, setWorking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<PayWith>("wallet");
  const [route, setRoute] = useState<PayoutRoute>("sepa");
  const [symbol, setSymbol] = useState("EURC");
  const [payee, setPayee] = useState("");
  const [total, setTotal] = useState("");
  const [rows, setRows] = useState<Row[]>(PRESETS[0].rows);
  const [fundNowChoice, setFundNow] = useState(true);
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [billing, setBilling] = useState<Billing>({});
  const [yieldChoice, setYieldChoice] = useState(true);
  const [verifier, setVerifier] = useState("");
  const [priceOpen, setPriceOpen] = useState(false);

  const bank = payWith === "bank";
  // A bank transfer is one payment for the total, so it always funds everything. Offline only ETH works.
  const fundNow = bank || fundNowChoice;
  const assets = bank ? (backendOnline ? TOKENS.filter((t) => t.symbol !== "USDC") : [ETH]) : TOKENS;
  const token = TOKENS.find((t) => t.symbol === symbol) ?? ETH;

  const choosePayWith = (value: PayWith) => {
    setPayWith(value);
    if (value === "bank" && (symbol === "USDC" || (!backendOnline && symbol !== "ETH"))) setSymbol(backendOnline ? "EURC" : "ETH");
  };

  const reset = () => {
    setStep(1);
    setPayee("");
    setTotal("");
    setRows(PRESETS[0].rows);
    setTitle("");
    setSpec("");
    setFiles([]);
    setBilling({});
    setVerifier("");
    setPriceOpen(false);
  };

  // The job exists once the transaction is confirmed: then say so, and read its number from the receipt.
  const confirming = useRefreshOnConfirm(txHash);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });
  const createdId = useMemo(() => {
    if (!receipt.isSuccess) return undefined;
    const [created] = parseEventLogs({ abi: escrowAbi as Abi, logs: receipt.data.logs, eventName: "JobCreated" });
    return created ? Number((created.args as unknown as { id: bigint }).id) : undefined;
  }, [receipt.isSuccess, receipt.data]);

  const { data: native } = useBalance({ address });
  const { data: tokenBalance } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!token.address && !!address },
  });
  // What the wallet holds of the chosen asset. Either way the deposit itself is made from this wallet.
  const balance = token.address ? tokenBalance : native?.value;

  const totalUnits = /^\d*\.?\d+$/.test(total) && Number(total) > 0 ? parseUnits(total, token.decimals) : 0n;
  const percents = rows.map((r) => (/^\d+$/.test(r.percent) ? BigInt(r.percent) : 0n));
  const percentSum = percents.reduce((a, b) => a + b, 0n);
  // Every milestone gets its share; the last one takes the rounding remainder so the parts add up exactly.
  const amounts = percents.map((p, i) => (i < rows.length - 1 ? (totalUnits * p) / 100n : 0n));
  if (rows.length > 0) amounts[rows.length - 1] = totalUnits - amounts.slice(0, -1).reduce((a, b) => a + b, 0n);
  const rowsValid = rows.length > 0 && percentSum === 100n && percents.every((p) => p > 0n) && rows.every((r) => Number(r.days) > 0 && r.title.trim());

  // A token with a vault can earn yield while the money is in escrow. The payer then pays no service fee. Only wallet
  // payments can take it: a bank transfer is always paid in EURC or ETH, which have none.
  const config = useTokenConfig(token);
  const hasYield = !bank && !!config && config.vault !== zeroAddress;
  const useYield = hasYield && yieldChoice;
  // The escrow prices the job: the fee the payee pays out of the payments, and the service fee the payer pays on top.
  const quote = useQuote(token, amounts, useYield, totalUnits > 0n && rowsValid && amounts.every((a) => a > 0n));
  // Funding as you go locks nothing now, and each milestone adds its own service fee when it is funded.
  const surcharge = fundNow ? (quote.surcharge ?? 0n) : 0n;
  const due = totalUnits + surcharge;
  const verifierValid = verifier === "" || (isAddress(verifier) && verifier.toLowerCase() !== payee.toLowerCase());
  const short = fundNow && balance !== undefined && due > balance;
  // What taking the yield saves on the service fee.
  const saved = hasYield ? amounts.reduce((sum, a) => sum + surchargeOn(a, config?.surchargeBps ?? 0), 0n) : 0n;
  const feePercent = (Number(config?.surchargeBps ?? 0) / 100).toString();
  const eur = token.eurPer > 0 ? toEur(token, due) : 0;
  const activePreset = PRESETS.find((p) => sameRows(p.rows, rows))?.label ?? null;

  /** What stops the job from going past this step, in words. Empty when nothing does. */
  const problem = (upTo: number): string => {
    if (upTo >= 1) {
      if (!isAddress(payee)) return payee ? "That isn't a valid wallet address." : "Enter the payee's wallet address.";
      if (title.trim().length === 0) return "Add a job title: what is this for?";
      if (totalUnits <= 0n) return "Enter the amount.";
      if (config && !config.enabled) return `${token.symbol} isn't accepted here.`;
      if (config && totalUnits < config.minJob) return `The smallest job is ${formatUnitsOf(token, config.minJob)}.`;
    }
    if (upTo >= 2) {
      if (percentSum !== 100n) return `The shares must add up to 100% (now ${percentSum}%).`;
      if (!rows.every((r) => r.title.trim())) return "Give every stage a name.";
      if (percents.some((p) => p === 0n)) return "Give every stage a share above 0%.";
      if (!rows.every((r) => Number(r.days) > 0)) return "Give every stage a number of days.";
      if (!verifierValid) return "The verifier must be an address, and not the payee.";
    }
    if (upTo >= 3) {
      if (short) return `Not enough ${token.symbol} in this wallet for the full amount.`;
      if (quote.problem) return quote.problem;
    }
    return "";
  };

  const busy = !!working || confirming;
  const setBillingField = (key: keyof Billing, value: string) => setBilling((b) => ({ ...b, [key]: value }));
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // The text recorded on-chain: the title, then the spec as text or, with files, a long spec or billing details, a pointer to a stored document.
  const makeDescription = async () => {
    const details = cleanBilling(billing);
    const needsDocument = backendOnline && (files.length > 0 || spec.trim().length > INLINE_SPEC_MAX || !!details);
    if (!needsDocument) return buildDescription(title, { text: spec });
    setWorking("Uploading files…");
    const uploaded = [];
    for (const file of files) uploaded.push(await uploadFile(file, address!));
    const ref = await uploadDoc({ version: 1, title: title.trim(), text: spec.trim(), files: uploaded, billing: details }, address!);
    return buildDescription(title, { ref });
  };

  const submit = async () => {
    setError(null);
    try {
      const description = await makeDescription();
      if (bank) {
        // The bank transfer runs on the Payment flow page, which shows every step.
        setPendingPayment({
          payee,
          amount: formatUnits(totalUnits, token.decimals),
          token: token.symbol === "EURC" ? "eurc" : "eth",
          description,
          route,
          milestones: rows.map((r, i) => ({ title: r.title.trim(), amount: formatUnits(amounts[i], token.decimals), days: r.days })),
        });
        reset();
        navigate("/flow");
        return;
      }
      if (fundNow && token.address) {
        await ensureAllowance(token.address, address!, due, () => setWorking("Approve the token in your wallet…"));
      }
      setWorking("Confirm in your wallet…");
      const items = rows.map((r, i) => ({ title: r.title.trim(), amount: amounts[i], duration: Math.round(Number(r.days) * DAY) }));
      setTxHash(
        await writeContractAsync({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "createJob",
          args: [payee, token.address ?? zeroAddress, description, items, { verifier: verifier || zeroAddress, useYield, fundNow }],
          value: fundNow && !token.address ? due : 0n,
        }),
      );
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setWorking("");
    }
  };

  const again = () => {
    reset();
    setTxHash(undefined);
  };

  // ---------------------------------------------------------------- screens

  // The form (or the confirmation) with the wallet beside it, so the balance is in sight at every step.
  const shell = (children: ReactNode) => (
    <div className={n.layout}>
      <div className={n.main}>{children}</div>
      <WalletCard className={n.wallet} />
    </div>
  );

  if (createdId !== undefined) {
    return shell(
      <>
        <section className={`${n.card} ${n.success}`}>
          <span className={n.check}>
            <Check size={26} />
          </span>
          <h2>Job created</h2>
          <p className={styles.muted}>
            {fundNow ? "The money is held in escrow. The payee can see it is there and start." : "Nothing is locked yet. You fund each stage when it starts."}
          </p>
          <div className={n.row}>
            <button className={styles.button} onClick={() => navigate(`/jobs/${createdId}`)}>
              Open the job
            </button>
            <button className={n.ghost} onClick={again}>
              Create another
            </button>
          </div>
        </section>
      </>,
    );
  }

  const stepper = (
    <ol className={n.stepper} aria-label="Steps">
      {STEPS.map((name, i) => {
        const k = i + 1;
        const cls = step === k ? n.cur : step > k ? n.done : "";
        return (
          <li key={name} className={cls} aria-current={step === k ? "step" : undefined}>
            <button type="button" className={n.stepButton} disabled={step <= k || busy} onClick={() => setStep(k)}>
              <span className={n.dot}>{step > k ? <Check size={13} /> : k}</span>
              <span className={n.stepName}>{name}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );

  const footer = (upTo: number, next: () => void, label: string) => {
    const why = problem(upTo);
    return (
      <div className={n.foot}>
        {step > 1 ? (
          <button type="button" className={n.ghost} disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : (
          <span />
        )}
        <div className={n.footRight}>
          <button type="button" className={styles.button} disabled={!!why || busy} onClick={next} aria-describedby={why ? "create-blocked" : undefined}>
            {label}
          </button>
          {why && !busy && (
            <span className={styles.hint} id="create-blocked" role="status">
              {why}
            </span>
          )}
        </div>
      </div>
    );
  };

  const stepOne = (
    <>
      <section className={n.card}>
        <h2>Who are you paying, and for what?</h2>
        <div className={n.field}>
          <label htmlFor="payee">Payee wallet address</label>
          <input id="payee" className={`${styles.input} ${n.mono}`} placeholder="0x…" autoComplete="off" spellCheck={false} value={payee} onChange={(e) => setPayee(e.target.value.trim())} />
          {isAddress(payee) && <ReputationBadge address={payee} role="payee" />}
        </div>
        <div className={n.field}>
          <label htmlFor="title">What is this for?</label>
          <input id="title" className={styles.input} placeholder="e.g. Logo redesign" maxLength={MAX_TITLE} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className={n.field}>
          <label htmlFor="amount">Amount</label>
          <div className={styles.amountRow}>
            <input id="amount" className={`${styles.input} ${n.amount}`} inputMode="decimal" placeholder="0.00" value={total} onChange={(e) => setTotal(e.target.value)} />
            <select className={styles.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Pay with">
              {assets.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </div>
          <span className={styles.muted}>
            {totalUnits > 0n && eur > 0 && `${token.symbol === "ETH" ? "≈" : "="} ${euro(toEur(token, totalUnits))}${token.symbol === "ETH" ? " (demo rate)" : ""} · `}
            {balance !== undefined && `Your balance: ${formatBalance(balance, token.decimals)} ${token.symbol}`}
            {balance === 0n && (token.address ? " · get free test tokens at faucet.circle.com" : " · you need some Base Sepolia ETH, from any Base Sepolia faucet")}
          </span>
        </div>
        {hasYield && (
          <label className={`${styles.yieldCard} ${useYield ? styles.yieldCardOn : ""}`}>
            <span className={styles.yieldText}>
              <span className={styles.yieldTitle}>
                <strong>Earn yield, pay no service fee</strong>
                {saved > 0n && (
                  <span className={styles.yieldSave}>
                    {useYield ? "Saves" : "Save"} {formatUnitsOf(token, saved)}
                  </span>
                )}
              </span>
              <span className={styles.muted}>
                {useYield
                  ? "While the job is in escrow, your money earns yield for Squirrel, and you get all of it back. You pay no extra fee."
                  : `You pay a ${feePercent}% service fee on top of each stage. Switch on and your money earns yield for Squirrel instead, so you pay none.`}
              </span>
            </span>
            <span className={styles.switch}>
              <input type="checkbox" role="switch" checked={useYield} onChange={(e) => setYieldChoice(e.target.checked)} aria-label="Earn yield instead of paying a service fee" />
              <span className={styles.switchTrack} />
            </span>
          </label>
        )}
      </section>
      {footer(1, () => setStep(2), "Continue")}
    </>
  );

  const stepTwo = (
    <>
      <section className={n.card}>
        <div>
          <h2>When should each part be paid?</h2>
          <p className={styles.muted}>The payee gets each stage when you approve it. The money for a stage is only released then.</p>
        </div>
        <div className={styles.presets}>
          <span className={styles.muted}>Split into</span>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className={`${styles.chipButton} ${activePreset === p.label ? styles.chipActive : ""}`} aria-pressed={activePreset === p.label} onClick={() => setRows(p.rows)}>
              {activePreset === p.label && <Check size={12} />} {p.label}
            </button>
          ))}
          {!activePreset && (
            <span className={`${styles.chipButton} ${styles.chipActive}`} aria-current="true">
              <Check size={12} /> Custom
            </span>
          )}
        </div>
        {rows.map((r, i) => (
          <div key={i} className={styles.milestoneRow}>
            <input className={styles.input} placeholder="Stage name" value={r.title} onChange={(e) => setRow(i, { title: e.target.value })} aria-label={`Stage ${i + 1} name`} />
            <div className={styles.suffixField}>
              <input className={styles.input} value={r.percent} onChange={(e) => setRow(i, { percent: e.target.value })} aria-label={`Stage ${i + 1} share of the total`} />
              <span className={styles.suffix}>%</span>
            </div>
            <div className={styles.suffixField}>
              <input className={styles.input} value={r.days} onChange={(e) => setRow(i, { days: e.target.value })} aria-label={`Stage ${i + 1} days to deliver`} />
              <span className={styles.suffix}>days</span>
            </div>
            <button type="button" className={styles.iconButton} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove stage ${i + 1}`}>
              <X size={16} />
            </button>
            {totalUnits > 0n && <span className={`${styles.muted} ${styles.milestoneAmount}`}>{formatUnitsOf(token, amounts[i])}</span>}
          </div>
        ))}
        <div className={styles.presets}>
          <button type="button" className={styles.chipButton} disabled={rows.length >= MAX_MILESTONES} onClick={() => setRows((rs) => [...rs, { title: "", percent: "", days: "7" }])}>
            <Plus size={12} /> Add a stage
          </button>
          <span className={percentSum === 100n ? n.ok : styles.error}>{percentSum === 100n ? "✓ Shares add up to 100%" : `Shares add up to ${percentSum}%, they must be 100%`}</span>
        </div>

        <details className={n.more}>
          <summary>More options</summary>
          <div className={n.moreInner}>
            <fieldset className={n.fieldset}>
              <legend>How do you pay?</legend>
              <label className={n.radio}>
                <input type="radio" name="paywith" checked={!bank} onChange={() => choosePayWith("wallet")} />
                <span>
                  <b>From my wallet</b> <span className={styles.muted}>ETH or a token. You confirm in your wallet.</span>
                </span>
              </label>
              <label className={n.radio}>
                <input type="radio" name="paywith" checked={bank} onChange={() => choosePayWith("bank")} />
                <span>
                  <b>Bank transfer in euros</b>{" "}
                  <span className={styles.muted}>Pay by SEPA. The bank steps are a sandbox demo.{!backendOnline && " The backend is offline, so it runs as a local demo with ETH."}</span>
                </span>
              </label>
              {bank && backendOnline && (
                <select className={styles.input} value={route} onChange={(e) => setRoute(e.target.value as PayoutRoute)} aria-label="Payee payout">
                  <option value="sepa">The payee is paid out by SEPA bank transfer</option>
                  <option value="eurc">The payee keeps EURC in their wallet</option>
                </select>
              )}
            </fieldset>
            <fieldset className={n.fieldset}>
              <legend>When do you pay?</legend>
              <label className={n.radio}>
                <input type="radio" name="fund" checked={fundNow} onChange={() => setFundNow(true)} />
                <span>
                  <b>Fund everything now</b> <span className={styles.muted}>Recommended. The payee can see the money is there.</span>
                </span>
              </label>
              <label className={`${n.radio} ${bank ? n.radioOff : ""}`}>
                <input type="radio" name="fund" disabled={bank} checked={!fundNow} onChange={() => setFundNow(false)} />
                <span>
                  <b>Fund each stage when it starts</b>{" "}
                  <span className={styles.muted}>{bank ? "Not available with a bank transfer, which pays the full amount at once." : "Nothing is locked until you do."}</span>
                </span>
              </label>
            </fieldset>
            <div className={n.field}>
              <label htmlFor="verifier">Verifier (optional)</label>
              <input id="verifier" className={`${styles.input} ${n.mono}`} placeholder="0x… an address that may approve delivered work for you" value={verifier} onChange={(e) => setVerifier(e.target.value.trim())} />
              {verifier !== "" && !verifierValid ? (
                <span className={styles.error}>The verifier must be an address, and not the payee.</span>
              ) : (
                <span className={styles.muted}>If a verifier approves a stage first, you can no longer dispute it. You can remove the verifier at any time.</span>
              )}
            </div>
            <div className={n.field}>
              <label htmlFor="spec">What should be delivered? (optional)</label>
              <textarea id="spec" className={styles.input} rows={3} value={spec} onChange={(e) => setSpec(e.target.value)} />
              {backendOnline ? <FileDrop files={files} onChange={setFiles} disabled={busy} /> : <span className={styles.muted}>Attaching files needs the backend, which is offline right now.</span>}
            </div>
            {backendOnline ? (
              <div className={n.field}>
                <label htmlFor="reference">Business details (optional)</label>
                <input id="reference" className={styles.input} placeholder="PO or invoice reference" maxLength={BILLING_MAX.reference} value={billing.reference ?? ""} onChange={(e) => setBillingField("reference", e.target.value)} />
                <div className={styles.amountRow}>
                  <input className={styles.input} placeholder="Payer company name" maxLength={BILLING_MAX.payerName} value={billing.payerName ?? ""} onChange={(e) => setBillingField("payerName", e.target.value)} aria-label="Payer company name" />
                  <input className={styles.input} placeholder="Payer VAT ID" maxLength={BILLING_MAX.payerVatId} value={billing.payerVatId ?? ""} onChange={(e) => setBillingField("payerVatId", e.target.value)} aria-label="Payer VAT ID" />
                </div>
                <div className={styles.amountRow}>
                  <input className={styles.input} placeholder="Payee company name" maxLength={BILLING_MAX.payeeName} value={billing.payeeName ?? ""} onChange={(e) => setBillingField("payeeName", e.target.value)} aria-label="Payee company name" />
                  <input className={styles.input} placeholder="Payee VAT ID" maxLength={BILLING_MAX.payeeVatId} value={billing.payeeVatId ?? ""} onChange={(e) => setBillingField("payeeVatId", e.target.value)} aria-label="Payee VAT ID" />
                </div>
                <span className={styles.muted}>Printed on the receipt as you enter it. Squirrel doesn&apos;t verify it. It is stored with the job, so anyone who looks the job up on-chain can read it.</span>
              </div>
            ) : (
              <span className={styles.muted}>Business details are stored by the backend, which is offline right now.</span>
            )}
          </div>
        </details>
      </section>
      {footer(2, () => setStep(3), "Review")}
    </>
  );

  const nothingNow = !fundNow;
  const stepThree = (
    <>
      <section className={n.card}>
        <h2>Check and pay</h2>
        <dl className={n.rows}>
          <div>
            <dt>To</dt>
            <dd className={n.mono}>{`${payee.slice(0, 6)}…${payee.slice(-4)}`}</dd>
          </div>
          <div>
            <dt>For</dt>
            <dd>{title}</dd>
          </div>
          <div>
            <dt>Paid with</dt>
            <dd>{bank ? "Bank transfer in euros" : token.symbol}</dd>
          </div>
        </dl>
        <table className={n.sched}>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Due</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.title}</td>
                <td className={styles.muted}>{nothingNow ? `${r.days} days after you fund it` : `within ${r.days} days`}</td>
                <td>{formatUnitsOf(token, amounts[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={n.total}>
          <span className={n.totalLabel}>{nothingNow ? "You pay now" : "You pay"}</span>
          <span className={n.totalValue}>{formatUnitsOf(token, nothingNow ? 0n : due)}</span>
          <span className={styles.muted}>
            {nothingNow
              ? useYield
                ? "Nothing is locked yet. You fund each stage when it starts, and pay no service fee because your money earns yield while it waits."
                : `Nothing is locked yet. You fund each stage when it starts, and pay a ${feePercent}% service fee on top of each one.`
              : useYield
                ? "No service fee. While your money is in escrow it earns yield for Squirrel, and you get all of it back."
                : `${formatUnitsOf(token, totalUnits)} for the job + ${formatUnitsOf(token, surcharge)} service fee`}
            {!nothingNow && eur > 0 && ` · ${token.symbol === "ETH" ? "≈ " : ""}${euro(eur)}`}
          </span>
          {!nothingNow && balance !== undefined && (
            <span className={styles.muted}>
              Your balance: {formatBalance(balance, token.decimals)} {token.symbol}
              {balance >= due && ` → ${formatBalance(balance - due, token.decimals)} ${token.symbol} after paying`}
            </span>
          )}
        </div>
        <div className={n.assure}>
          <Lock size={18} />
          <span>
            {nothingNow
              ? "Each stage is held in escrow once you fund it. It goes to the payee only when you approve it."
              : "Your money is held in escrow. It goes to the payee only when you approve each stage, and comes back to you if nothing is delivered in time."}
          </span>
        </div>
        <div>
          <button type="button" className={n.link} aria-expanded={priceOpen} onClick={() => setPriceOpen((o) => !o)}>
            How is this priced?
          </button>
        </div>
        {priceOpen && (
          <p className={styles.muted}>
            The payee pays Squirrel a fee{quote.fee !== undefined ? ` of ${formatUnitsOf(token, quote.fee)}` : ""} (the larger of a minimum and 0.25% of the job) out of what they receive, shared between the stages.{" "}
            {useYield ? "You pay nothing extra because your money earns yield while it waits." : `You pay ${feePercent}% on top of each stage.${hasYield ? " Choose to earn yield on the first step to avoid it." : ""}`}
          </p>
        )}
      </section>
      <div className={n.payBlock}>
        <button type="button" className={`${styles.button} ${n.payButton}`} disabled={!!problem(3) || busy} onClick={submit} aria-describedby={problem(3) ? "create-blocked" : undefined}>
          {working || (bank ? `Pay by bank transfer${eur > 0 ? ` (${euro(eur)})` : ""}` : nothingNow ? "Create the job" : `Pay ${formatUnitsOf(token, due)}`)}
        </button>
        {problem(3) && !busy && (
          <span className={styles.hint} id="create-blocked" role="status">
            {problem(3)}
          </span>
        )}
        <span className={styles.muted}>
          {bank
            ? token.address
              ? "Your EURC is taken from your wallet at the deposit step: approve, then deposit."
              : "You confirm the deposit once in your wallet."
            : nothingNow || !token.address
              ? "You confirm once in your wallet."
              : "You confirm twice in your wallet: allow the token, then deposit."}
        </span>
        {error && <p className={styles.error}>{error}</p>}
        <div>
          <button type="button" className={n.ghost} disabled={busy} onClick={() => setStep(2)}>
            Back
          </button>
        </div>
      </div>
    </>
  );

  return shell(
    <>
      {stepper}
      {step === 1 ? stepOne : step === 2 ? stepTwo : stepThree}
    </>,
  );
}

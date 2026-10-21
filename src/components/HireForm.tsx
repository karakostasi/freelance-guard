import { useState } from "react";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";
import { erc20Abi, formatUnits, isAddress, parseUnits, zeroAddress } from "viem";
import { Check, Plus, X } from "lucide-react";
import { escrowAbi, escrowAddress } from "../wagmi";
import { useBackendStatus } from "../hooks/useBackend";
import type { FundingForm } from "../hooks/useFiatFunding";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { buildDescription } from "../lib/documents";
import { ensureAllowance } from "../lib/erc20";
import { uploadDoc, uploadFile } from "../lib/files";
import { FileDrop } from "./FileDrop";
import type { PayoutRoute } from "../lib/fiatFlow";
import { euro } from "../lib/jobs";
import { ETH, TOKENS, formatBalance, formatUnitsOf, toEur } from "../lib/tokens";
import styles from "../App.module.css";

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

const MAX_MILESTONES = 20;
const MAX_TITLE = 80;
// Short specs are written on-chain as they are. Longer ones, and anything with files, become a stored document.
const INLINE_SPEC_MAX = 280;
const DAY = 86400;

const sameRows = (a: Row[], b: Row[]) => a.length === b.length && a.every((r, i) => r.title === b[i].title && r.percent === b[i].percent && r.days === b[i].days);

/**
 * The one form for hiring a freelancer. The client pays either from their wallet (an on-chain
 * transaction right here) or by bank transfer in euros (handed to `onBank`, which runs the live payment flow).
 */
export function HireForm({ variant = "page", onBank, onCreated }: { variant?: "page" | "drawer"; onBank: (form: FundingForm) => void; onCreated?: () => void }) {
  const { address } = useAccount();
  const { online: backendOnline } = useBackendStatus();
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [working, setWorking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<PayWith>("wallet");
  const [route, setRoute] = useState<PayoutRoute>("sepa");
  const [symbol, setSymbol] = useState("ETH");
  const [freelancer, setFreelancer] = useState("");
  const [total, setTotal] = useState("");
  const [rows, setRows] = useState<Row[]>(PRESETS[0].rows);
  const [fundNowChoice, setFundNow] = useState(true);
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [files, setFiles] = useState<File[]>([]);

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
    setFreelancer("");
    setTotal("");
    setRows(PRESETS[0].rows);
    setTitle("");
    setSpec("");
    setFiles([]);
  };

  // Clear the form only once the job exists on-chain, so a rejected tx keeps the input.
  const confirming = useRefreshOnConfirm(txHash, reset);

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
  // The deposit is signed in this wallet for both ways of paying, so it needs the funds at hand.
  const short = fundNow && balance !== undefined && totalUnits > balance;
  const valid = isAddress(freelancer) && title.trim().length > 0 && totalUnits > 0n && rowsValid && !short;
  const busy = !!working || confirming;
  // The split matches a preset until the rows are edited, then it is a custom split.
  const activePreset = PRESETS.find((p) => sameRows(p.rows, rows))?.label ?? null;
  const eur = token.eurPer > 0 ? toEur(token, totalUnits) : 0;

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // The text recorded on-chain: the title, then the spec as text or, with files or a long spec, a pointer to a stored document.
  const makeDescription = async () => {
    const needsDocument = backendOnline && (files.length > 0 || spec.trim().length > INLINE_SPEC_MAX);
    if (!needsDocument) return buildDescription(title, { text: spec });
    setWorking("Uploading files…");
    const uploaded = [];
    for (const file of files) uploaded.push(await uploadFile(file, address!));
    const ref = await uploadDoc({ version: 1, title: title.trim(), text: spec.trim(), files: uploaded }, address!);
    return buildDescription(title, { ref });
  };

  const submit = async () => {
    setError(null);
    if (bank) {
      try {
        const description = await makeDescription();
        onBank({
          freelancer,
          amount: formatUnits(totalUnits, token.decimals),
          token: token.symbol === "EURC" ? "eurc" : "eth",
          description,
          route,
          milestones: rows.map((r, i) => ({ title: r.title.trim(), amount: formatUnits(amounts[i], token.decimals), days: r.days })),
        });
        reset();
      } catch (e) {
        setError((e as Error).message.split("\n")[0]);
      } finally {
        setWorking("");
      }
      return;
    }
    try {
      const description = await makeDescription();
      if (fundNow && token.address) {
        await ensureAllowance(token.address, address!, totalUnits, () => setWorking("Approve the token in your wallet…"));
      }
      setWorking("Confirm in your wallet…");
      const items = rows.map((r, i) => ({ title: r.title.trim(), amount: amounts[i], duration: Math.round(Number(r.days) * DAY) }));
      setTxHash(
        await writeContractAsync({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "createJob",
          args: [freelancer, token.address ?? zeroAddress, description, items, fundNow],
          value: fundNow && !token.address ? totalUnits : 0n,
        }),
      );
      onCreated?.();
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setWorking("");
    }
  };

  const body = (
    <>
      <div className={styles.formGroup}>
        <h3 className={styles.groupTitle}>Who and how much</h3>
        <input className={styles.input} placeholder="Freelancer address (0x…)" value={freelancer} onChange={(e) => setFreelancer(e.target.value)} />
        <div className={styles.amountRow}>
          <input className={styles.input} placeholder={`Total amount (${token.symbol})`} value={total} onChange={(e) => setTotal(e.target.value)} />
          <select className={styles.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Asset">
            {assets.map((t) => (
              <option key={t.symbol} value={t.symbol}>
                {t.symbol}
              </option>
            ))}
          </select>
        </div>
        {totalUnits > 0n && eur > 0 && (
          <span className={styles.muted}>
            {token.symbol === "ETH" ? "≈" : "="} {euro(eur)}
            {token.symbol === "ETH" && " (demo rate)"}
          </span>
        )}
        {balance !== undefined && (
          <span className={styles.muted}>
            Your balance: {formatBalance(balance, token.decimals)} {token.symbol}
            {balance === 0n && (token.address ? " · get free test tokens at faucet.circle.com" : " · you need some Base Sepolia ETH, from any Base Sepolia faucet")}
          </span>
        )}
        {short && <span className={styles.error}>Not enough {token.symbol} in this wallet for the full amount.</span>}
      </div>

      <div className={styles.formGroup}>
        <h3 className={styles.groupTitle}>How do you pay?</h3>
        <div className={styles.optionCards} role="radiogroup" aria-label="Pay with">
          <label className={`${styles.optionCard} ${!bank ? styles.optionCardActive : ""}`}>
            <input type="radio" checked={!bank} onChange={() => choosePayWith("wallet")} />
            <span>
              <strong>From my wallet</strong>
              <span className={styles.muted}>Pay with ETH or a token. You confirm the transaction in your wallet.</span>
            </span>
          </label>
          <label className={`${styles.optionCard} ${bank ? styles.optionCardActive : ""}`}>
            <input type="radio" checked={bank} onChange={() => choosePayWith("bank")} />
            <span>
              <strong>Bank transfer in euros</strong>
              <span className={styles.muted}>
                Pay by SEPA. We convert it and deposit into escrow, and show every step. The bank steps are a sandbox demo.
                {!backendOnline && " Backend offline: runs as a local demo with ETH."}
              </span>
            </span>
          </label>
        </div>
        {bank && backendOnline && (
          <select className={styles.input} value={route} onChange={(e) => setRoute(e.target.value as PayoutRoute)} aria-label="Freelancer payout">
            <option value="sepa">Freelancer is paid out by SEPA bank transfer</option>
            <option value="eurc">Freelancer keeps EURC in their wallet</option>
          </select>
        )}
      </div>

      <div className={styles.formGroup}>
        <h3 className={styles.groupTitle}>When do you pay?</h3>
        <div className={styles.optionCards} role="radiogroup" aria-label="Funding">
          <label className={`${styles.optionCard} ${fundNow ? styles.optionCardActive : ""}`}>
            <input type="radio" checked={fundNow} onChange={() => setFundNow(true)} />
            <span>
              <strong>Fund everything now</strong>
              <span className={styles.muted}>Lock the full amount in escrow today. The freelancer can see the money is there.</span>
            </span>
          </label>
          <label className={`${styles.optionCard} ${!fundNow ? styles.optionCardActive : ""} ${bank ? styles.optionCardDisabled : ""}`}>
            <input type="radio" checked={!fundNow} disabled={bank} onChange={() => setFundNow(false)} />
            <span>
              <strong>Fund as you go</strong>
              <span className={styles.muted}>{bank ? "Not available with a bank transfer, which pays the full amount at once." : "Fund each milestone when it starts. Nothing is locked until you do."}</span>
            </span>
          </label>
        </div>
      </div>

      <div className={styles.formGroup}>
        <h3 className={styles.groupTitle}>Milestones</h3>
        <div className={styles.presets}>
          <span className={styles.muted}>Split into:</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`${styles.chipButton} ${activePreset === p.label ? styles.chipActive : ""}`}
              aria-pressed={activePreset === p.label}
              onClick={() => setRows(p.rows)}
            >
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
            <input className={styles.input} placeholder="Milestone title" value={r.title} onChange={(e) => setRow(i, { title: e.target.value })} />
            <div className={styles.suffixField}>
              <input className={styles.input} value={r.percent} onChange={(e) => setRow(i, { percent: e.target.value })} aria-label="Share of the total" />
              <span className={styles.suffix}>%</span>
            </div>
            <div className={styles.suffixField}>
              <input className={styles.input} value={r.days} onChange={(e) => setRow(i, { days: e.target.value })} aria-label="Days to deliver" />
              <span className={styles.suffix}>days</span>
            </div>
            <button type="button" className={styles.iconButton} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove milestone">
              <X size={16} />
            </button>
            {totalUnits > 0n && <span className={`${styles.muted} ${styles.milestoneAmount}`}>{formatUnitsOf(token, amounts[i])}</span>}
          </div>
        ))}
        <div className={styles.presets}>
          <button type="button" className={styles.chipButton} disabled={rows.length >= MAX_MILESTONES} onClick={() => setRows((rs) => [...rs, { title: "", percent: "", days: "7" }])}>
            <Plus size={12} /> Add milestone
          </button>
          <span className={percentSum === 100n ? styles.muted : styles.error}>Shares add up to {percentSum.toString()}% {percentSum !== 100n && "(must be 100%)"}</span>
        </div>
      </div>

      <div className={styles.formGroup}>
        <h3 className={styles.groupTitle}>Details</h3>
        <input className={styles.input} placeholder="Job title" maxLength={MAX_TITLE} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Job title" />
        <textarea className={styles.input} placeholder="What should be delivered? (optional)" rows={3} value={spec} onChange={(e) => setSpec(e.target.value)} />
        {backendOnline ? (
          <FileDrop files={files} onChange={setFiles} disabled={busy} />
        ) : (
          <span className={styles.muted}>Attaching files needs the backend, which is offline right now.</span>
        )}
        <button className={styles.button} disabled={!valid || busy} onClick={submit}>
          {working || (bank ? `Pay by bank transfer${eur > 0 ? ` (${euro(eur)})` : ""}` : fundNow ? "Create job and fund escrow" : "Create job")}
        </button>
        {!bank && token.address && fundNow && <span className={styles.muted}>Tokens need two confirmations: approve, then deposit.</span>}
        {bank && token.address && <span className={styles.muted}>EURC is taken from your wallet at the deposit step: approve, then deposit.</span>}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </>
  );

  if (variant === "drawer") return <div className={styles.drawerForm}>{body}</div>;
  return (
    <section className={styles.section}>
      <h2>Hire a freelancer</h2>
      {body}
    </section>
  );
}

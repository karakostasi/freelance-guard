import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { readContract, waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi, formatUnits, isAddress, parseUnits } from "viem";
import { config, escrowAbi, escrowAddress } from "../wagmi";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import { TOKENS } from "../lib/tokens";
import styles from "../App.module.css";

type Step = "idle" | "approving" | "creating";

const deadlineIn = (days: string) => BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86400);

export function CreateJob() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("ETH");
  const [freelancer, setFreelancer] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("");
  const [description, setDescription] = useState("");

  const token = TOKENS.find((t) => t.symbol === symbol)!;

  // Clear the form only once the escrow is actually funded, so a rejected tx keeps the input.
  const confirming = useRefreshOnConfirm(txHash, () => {
    setFreelancer("");
    setAmount("");
    setDays("");
    setDescription("");
  });

  const { data: balance } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!token.address && !!address },
  });

  const units = /^\d*\.?\d+$/.test(amount) && Number(amount) > 0 ? parseUnits(amount, token.decimals) : 0n;
  const short = !!token.address && balance !== undefined && units > balance;
  const valid = isAddress(freelancer) && units > 0n && Number(days) > 0 && !short;
  const busy = step !== "idle" || confirming;

  const submit = async () => {
    setError(null);
    try {
      const deadline = deadlineIn(days);
      if (!token.address) {
        setStep("creating");
        setTxHash(await writeContractAsync({ address: escrowAddress, abi: escrowAbi, functionName: "createJob", args: [freelancer, deadline, description], value: units }));
      } else {
        // Tokens need the escrow to be allowed to pull them first.
        const allowance = await readContract(config, { address: token.address, abi: erc20Abi, functionName: "allowance", args: [address!, escrowAddress] });
        if (allowance < units) {
          setStep("approving");
          const approval = await writeContractAsync({ address: token.address, abi: erc20Abi, functionName: "approve", args: [escrowAddress, units] });
          await waitForTransactionReceipt(config, { hash: approval });
        }
        setStep("creating");
        setTxHash(
          await writeContractAsync({
            address: escrowAddress,
            abi: escrowAbi,
            functionName: "createTokenJob",
            args: [freelancer, deadline, description, token.address, units],
          }),
        );
      }
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setStep("idle");
    }
  };

  return (
    <section className={styles.section}>
      <h2>Hire a freelancer</h2>
      <input className={styles.input} placeholder="Freelancer address (0x…)" value={freelancer} onChange={(e) => setFreelancer(e.target.value)} />
      <div className={styles.amountRow}>
        <input className={styles.input} placeholder={`Amount (${token.symbol})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select className={styles.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Asset">
          {TOKENS.map((t) => (
            <option key={t.symbol} value={t.symbol}>
              {t.symbol}
            </option>
          ))}
        </select>
      </div>
      {token.address && balance !== undefined && (
        <span className={styles.muted}>
          Your balance: {formatUnits(balance, token.decimals)} {token.symbol}
          {balance === 0n && " · get free test tokens at faucet.circle.com"}
        </span>
      )}
      {short && <span className={styles.error}>Not enough {token.symbol} in this wallet.</span>}
      <div className={styles.suffixField}>
        <input className={styles.input} placeholder="Days to deliver" value={days} onChange={(e) => setDays(e.target.value)} />
        <span className={styles.suffix}>days</span>
      </div>
      <textarea className={styles.input} placeholder="Job description or IPFS link" value={description} onChange={(e) => setDescription(e.target.value)} />
      <button className={styles.button} disabled={!valid || busy} onClick={submit}>
        {step === "approving" ? "Approve the token in your wallet…" : step === "creating" ? "Confirm the deposit in your wallet…" : "Fund escrow"}
      </button>
      {token.address && <span className={styles.muted}>Tokens need two confirmations: approve, then deposit.</span>}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

import { useState } from "react";
import { useWriteContract } from "wagmi";
import { isAddress, parseEther } from "viem";
import { escrowAbi, escrowAddress } from "../wagmi";
import { useRefreshOnConfirm } from "../hooks/useRefreshOnConfirm";
import styles from "../App.module.css";

export function CreateJob() {
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const [freelancer, setFreelancer] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("");
  const [description, setDescription] = useState("");

  // Clear the form only once the escrow is actually funded, so a rejected tx keeps the input.
  const confirming = useRefreshOnConfirm(txHash, () => {
    setFreelancer("");
    setAmount("");
    setDays("");
    setDescription("");
  });

  const valid = isAddress(freelancer) && Number(amount) > 0 && Number(days) > 0;

  return (
    <section className={styles.section}>
      <h2>Hire a freelancer</h2>
      <input className={styles.input} placeholder="Freelancer address (0x…)" value={freelancer} onChange={(e) => setFreelancer(e.target.value)} />
      <input className={styles.input} placeholder="Amount (ETH)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div className={styles.suffixField}>
        <input className={styles.input} placeholder="Days to deliver" value={days} onChange={(e) => setDays(e.target.value)} />
        <span className={styles.suffix}>days</span>
      </div>
      <textarea className={styles.input} placeholder="Job description or IPFS link" value={description} onChange={(e) => setDescription(e.target.value)} />
      <button className={styles.button}
        disabled={!valid || isPending || confirming}
        onClick={() =>
          writeContract({
            address: escrowAddress,
            abi: escrowAbi,
            functionName: "createJob",
            args: [freelancer, BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86400), description],
            value: parseEther(amount),
          })
        }
      >
        Fund escrow
      </button>
      {error && <p className={styles.error}>{error.message.split("\n")[0]}</p>}
    </section>
  );
}

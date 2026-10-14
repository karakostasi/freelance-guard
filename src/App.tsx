import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useReadContract, useWriteContract } from "wagmi";
import { isAddress, parseEther, formatEther } from "viem";
import { escrowAbi, escrowAddress } from "./wagmi";
import styles from "./App.module.css";

const STATUS = ["None", "Funded", "Submitted", "Disputed", "Paid", "Refunded"];

function CreateJob() {
  const { writeContract, isPending, error } = useWriteContract();
  const [freelancer, setFreelancer] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("7");
  const [description, setDescription] = useState("");

  const valid = isAddress(freelancer) && Number(amount) > 0 && Number(days) > 0;

  return (
    <section className={styles.section}>
      <h2>Hire a freelancer</h2>
      <input className={styles.input} placeholder="Freelancer address (0x…)" value={freelancer} onChange={(e) => setFreelancer(e.target.value)} />
      <input className={styles.input} placeholder="Amount (ETH)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input className={styles.input} placeholder="Days to deliver" value={days} onChange={(e) => setDays(e.target.value)} />
      <textarea className={styles.input} placeholder="Job description or IPFS link" value={description} onChange={(e) => setDescription(e.target.value)} />
      <button className={styles.button}
        disabled={!valid || isPending}
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

function JobPanel() {
  const { address } = useAccount();
  const { writeContract, error } = useWriteContract();
  const [id, setId] = useState("1");
  const [deliverable, setDeliverable] = useState("");

  const { data: job } = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "jobs",
    args: [BigInt(id || 0)],
  }) as { data: readonly [string, string, bigint, bigint, bigint, number, string, string] | undefined };

  const call = (functionName: string, args: unknown[]) =>
    writeContract({ address: escrowAddress, abi: escrowAbi, functionName, args });

  const isClient = job && address?.toLowerCase() === job[0].toLowerCase();
  const isFreelancer = job && address?.toLowerCase() === job[1].toLowerCase();
  const status = job ? STATUS[job[5]] : "";
  const n = BigInt(id || 0);

  return (
    <section className={styles.section}>
      <h2>Job</h2>
      <input className={styles.input} value={id} onChange={(e) => setId(e.target.value)} placeholder="Job id" />
      {job && status !== "None" && (
        <>
          <p>Client: {job[0]}</p>
          <p>Freelancer: {job[1]}</p>
          <p>Amount: {formatEther(job[2])} ETH</p>
          <p>Status: {status}</p>
          <p>Spec: {job[6]}</p>
          {job[7] && <p>Deliverable: {job[7]}</p>}

          {isFreelancer && status === "Funded" && (
            <>
              <input className={styles.input} placeholder="Deliverable link" value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
              <button className={styles.button} onClick={() => call("submitWork", [n, deliverable])}>Submit work</button>
            </>
          )}
          {isFreelancer && status === "Submitted" && (
            <button className={styles.button} onClick={() => call("claimAfterTimeout", [n])}>Claim (after review period)</button>
          )}
          {isClient && status === "Submitted" && (
            <>
              <button className={styles.button} onClick={() => call("approve", [n])}>Approve & pay</button>
              <button className={styles.button} onClick={() => call("dispute", [n])}>Dispute</button>
            </>
          )}
          {isClient && status === "Funded" && (
            <button className={styles.button} onClick={() => call("refundExpired", [n])}>Refund (after deadline)</button>
          )}
        </>
      )}
      {error && <p className={styles.error}>{error.message.split("\n")[0]}</p>}
    </section>
  );
}

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <main className={styles.page}>
      <h1>Freelance Guard</h1>
      {isConnected ? (
        <p>
          {address} <button className={styles.button} onClick={() => disconnect()}>Disconnect</button>
        </p>
      ) : (
        <>
          <button className={styles.button} onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>
          {connectError && <p className={styles.error}>{connectError.message.split("\n")[0]}</p>}
        </>
      )}
      {isConnected && (
        <>
          <CreateJob />
          <JobPanel />
        </>
      )}
    </main>
  );
}

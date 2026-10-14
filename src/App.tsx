import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useConnect, useDisconnect, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { isAddress, parseEther, formatEther, type Abi } from "viem";
import { escrowAbi, escrowAddress } from "./wagmi";
import styles from "./App.module.css";

const STATUS = ["None", "Funded", "Submitted", "Disputed", "Paid", "Refunded"];

type Job = readonly [string, string, bigint, bigint, bigint, number, string, string];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function useRefreshOnConfirm(hash: `0x${string}` | undefined) {
  const queryClient = useQueryClient();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (isSuccess) queryClient.invalidateQueries();
  }, [isSuccess, queryClient]);
  return isLoading;
}

function MyJobs({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { address } = useAccount();
  const { data: count } = useReadContract({ address: escrowAddress, abi: escrowAbi, functionName: "jobCount" });
  const total = Number(count ?? 0n);
  const { data } = useReadContracts({
    contracts: Array.from({ length: total }, (_, i) => ({
      address: escrowAddress,
      abi: escrowAbi as Abi,
      functionName: "jobs",
      args: [BigInt(i + 1)],
    })),
    query: { enabled: total > 0 },
  });

  const me = address?.toLowerCase();
  const mine = (data ?? [])
    .map((r, i) => ({ id: i + 1, job: r.result as Job | undefined }))
    .filter(({ job }) => job && (job[0].toLowerCase() === me || job[1].toLowerCase() === me))
    .reverse();

  return (
    <section className={styles.section}>
      <h2>My jobs</h2>
      {mine.length === 0 && <p>No jobs for this account yet.</p>}
      <div className={styles.cards}>
        {mine.map(({ id, job }) => {
          const isClient = job![0].toLowerCase() === me;
          return (
            <button
              key={id}
              className={`${styles.card} ${selected === String(id) ? styles.cardActive : ""}`}
              onClick={() => onSelect(String(id))}
            >
              <strong>Job #{id}</strong>
              <span className={styles.badge}>{STATUS[job![5]]}</span>
              <span>{formatEther(job![2])} ETH</span>
              <span className={styles.muted}>
                {isClient ? "You hired" : "Hired by"} {short(isClient ? job![1] : job![0])}
              </span>
              <span className={styles.muted}>{isClient ? "Client" : "Freelancer"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CreateJob() {
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const confirming = useRefreshOnConfirm(txHash);
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

function JobPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { address } = useAccount();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const confirming = useRefreshOnConfirm(txHash);
  const [deliverable, setDeliverable] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data, isLoading, error: readError } = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "jobs",
    args: [BigInt(id || 0)],
  });
  const job = data as readonly [string, string, bigint, bigint, bigint, number, string, string] | undefined;

  const call = (functionName: string, args: unknown[]) =>
    writeContract({ address: escrowAddress, abi: escrowAbi, functionName, args });

  const isClient = job && address?.toLowerCase() === job[0].toLowerCase();
  const isFreelancer = job && address?.toLowerCase() === job[1].toLowerCase();
  const status = job ? STATUS[job[5]] : "";
  const n = BigInt(id || 0);

  return (
    <div className={styles.overlay} onClick={onClose}>
    <section className={styles.modal} onClick={(e) => e.stopPropagation()}>
      <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
      <h2>Job #{id}</h2>
      {isLoading && <p>Loading…</p>}
      {readError && <p className={styles.error}>{readError.message.split("\n")[0]}</p>}
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
      {(isPending || confirming) && <p>Waiting for transaction…</p>}
      {error && <p className={styles.error}>{error.message.split("\n")[0]}</p>}
    </section>
    </div>
  );
}

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const [selected, setSelected] = useState("");

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
          <MyJobs selected={selected} onSelect={setSelected} />
          {selected && <JobPanel id={selected} onClose={() => setSelected("")} />}
        </>
      )}
    </main>
  );
}

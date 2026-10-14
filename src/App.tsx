import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { CreateJob } from "./components/CreateJob";
import { JobPanel } from "./components/JobPanel";
import { MyJobs } from "./components/MyJobs";
import styles from "./App.module.css";

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

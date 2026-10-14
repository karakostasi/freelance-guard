import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { CreateJob } from "./components/CreateJob";
import { JobPanel } from "./components/JobPanel";
import { MyJobs } from "./components/MyJobs";
import { WalletBar } from "./components/WalletBar";
import logo from "./assets/logo.svg";
import styles from "./App.module.css";

export default function App() {
  const { isConnected } = useAccount();
  const { connect, connectors, error: connectError } = useConnect();
  const [selected, setSelected] = useState("");

  return (
    <main className={styles.page}>
      <header className={styles.brand}>
        <img src={logo} alt="" className={styles.logo} />
        <h1>Freelance Guard</h1>
      </header>
      {isConnected ? (
        <WalletBar />
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

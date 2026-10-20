import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { Briefcase, Workflow } from "lucide-react";
import { CreateJob } from "./components/CreateJob";
import { FlowPage } from "./components/FlowPage";
import { JobPanel } from "./components/JobPanel";
import { MyJobs } from "./components/MyJobs";
import { WalletBar } from "./components/WalletBar";
import { navigate, useHashRoute } from "./hooks/useHashRoute";
import logo from "./assets/logo.svg";
import styles from "./App.module.css";

export default function App() {
  const { isConnected } = useAccount();
  const { connect, connectors, error: connectError } = useConnect();
  const [selected, setSelected] = useState("");
  const route = useHashRoute();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <img src={logo} alt="" className={styles.logo} />
          <h1>Freelance Guard</h1>
        </div>
        <nav className={styles.nav}>
          <button className={`${styles.navLink} ${route.page === "jobs" ? styles.navActive : ""}`} onClick={() => navigate("/")}>
            <Briefcase size={16} /> Jobs
          </button>
          <button className={`${styles.navLink} ${route.page === "flow" ? styles.navActive : ""}`} onClick={() => navigate("/flow")}>
            <Workflow size={16} /> Payment flow
          </button>
        </nav>
      </header>
      {isConnected ? (
        <WalletBar />
      ) : (
        <>
          <button className={styles.button} onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>
          {connectError && <p className={styles.error}>{connectError.message.split("\n")[0]}</p>}
        </>
      )}
      {isConnected && route.page === "flow" && <FlowPage jobId={route.jobId} />}
      {isConnected && route.page === "jobs" && (
        <div className={styles.narrow}>
          <CreateJob />
          <MyJobs selected={selected} onSelect={setSelected} />
          {selected && <JobPanel id={selected} onClose={() => setSelected("")} />}
        </div>
      )}
    </main>
  );
}

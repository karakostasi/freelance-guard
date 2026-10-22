import { useAccount } from "wagmi";
import { Briefcase, Workflow } from "lucide-react";
import { ConnectButton } from "./components/ConnectButton";
import { FlowPage } from "./components/FlowPage";
import { JobsPage } from "./components/JobsPage";
import { Landing } from "./components/Landing";
import { ProfileMenu } from "./components/ProfileMenu";
import { navigate, useHashRoute } from "./hooks/useHashRoute";
import logo from "./assets/logo.svg";
import styles from "./App.module.css";

export default function App() {
  const { isConnected } = useAccount();
  const route = useHashRoute();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={`${styles.brand} ${styles.brandLink}`} href="#/" aria-label="Home">
          <img src={logo} alt="" className={styles.logo} />
          <h1>Freelance Guard</h1>
        </a>
        <div className={styles.headerRight}>
          <nav className={styles.nav}>
            <button className={`${styles.navLink} ${route.page === "jobs" ? styles.navActive : ""}`} onClick={() => navigate("/jobs")}>
              <Briefcase size={16} /> Jobs
            </button>
            <button className={`${styles.navLink} ${route.page === "flow" ? styles.navActive : ""}`} onClick={() => navigate("/flow")}>
              <Workflow size={16} /> Payment flow
            </button>
          </nav>
          <ProfileMenu />
        </div>
      </header>
      {route.page === "home" && <Landing />}
      {!isConnected && route.page !== "home" && (
        <div className={styles.connectPrompt}>
          <p>Sign in to continue.</p>
          <ConnectButton className={styles.button}>Sign in</ConnectButton>
        </div>
      )}
      {isConnected && route.page === "flow" && <FlowPage jobId={route.jobId} />}
      {isConnected && route.page === "jobs" && <JobsPage />}
    </main>
  );
}

import { useAccount } from "wagmi";
import { Briefcase, Plus, Workflow } from "lucide-react";
import { FlowPage } from "./components/FlowPage";
import { JobsPage } from "./components/JobsPage";
import { NewJobPage } from "./components/NewJobPage";
import { Landing } from "./components/Landing";
import { ProfileMenu } from "./components/ProfileMenu";
import { SignInButtons } from "./components/SignInButtons";
import { ThemeToggle } from "./components/ThemeToggle";
import { ReceiptPage } from "./components/ReceiptPage";
import { navigate, useHashRoute } from "./hooks/useHashRoute";
import logo from "./assets/logo.svg";
import styles from "./App.module.css";

export default function App() {
  const { isConnected } = useAccount();
  const route = useHashRoute();

  return (
    <main className={styles.page}>
      <header className={`${styles.header} ${styles.noPrint}`}>
        <a className={`${styles.brand} ${styles.brandLink}`} href="#/" aria-label="Home">
          <img src={logo} alt="" className={styles.logo} />
          <h1>Squirrel</h1>
        </a>
        <div className={styles.headerRight}>
          <nav className={styles.nav}>
            <button className={`${styles.navLink} ${route.page === "new" ? styles.navActive : ""}`} onClick={() => navigate("/new")} aria-current={route.page === "new" ? "page" : undefined}>
              <Plus size={16} /> Create a job
            </button>
            <button className={`${styles.navLink} ${route.page === "jobs" ? styles.navActive : ""}`} onClick={() => navigate("/jobs")}>
              <Briefcase size={16} /> Jobs
            </button>
            <button className={`${styles.navLink} ${route.page === "flow" ? styles.navActive : ""}`} onClick={() => navigate("/flow")}>
              <Workflow size={16} /> Payment flow
            </button>
          </nav>
          <div className={styles.account}>
            <ThemeToggle />
            <ProfileMenu />
          </div>
        </div>
      </header>
      {route.page === "home" && <Landing />}
      {route.page === "receipt" && <ReceiptPage jobId={route.jobId} milestone={route.milestone} />}
      {!isConnected && route.page !== "home" && route.page !== "receipt" && (
        <div className={styles.connectPrompt}>
          <p>Sign in to continue.</p>
          <SignInButtons />
          <p className={styles.muted}>Sign in with your email and we send you a code. No wallet app, no seed phrase.</p>
        </div>
      )}
      {isConnected && route.page === "flow" && <FlowPage jobId={route.jobId} />}
      {isConnected && route.page === "new" && <NewJobPage />}
      {isConnected && route.page === "jobs" && <JobsPage jobId={route.jobId} />}
    </main>
  );
}

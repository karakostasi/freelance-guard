import { Briefcase, Plus, Workflow } from "lucide-react";
import { FlowPage } from "./components/FlowPage";
import { JobsPage } from "./components/JobsPage";
import { NewJobPage } from "./components/NewJobPage";
import { Landing } from "./components/Landing";
import { ProfileMenu } from "./components/ProfileMenu";
import { SignInGate } from "./components/SignInGate";
import { ThemeToggle } from "./components/ThemeToggle";
import { ReceiptPage } from "./components/ReceiptPage";
import { navigate, useHashRoute } from "./hooks/useHashRoute";
import { useConfig } from "wagmi";
import { useBackendStatus } from "./hooks/useBackend";
import { useSession } from "./hooks/useSession";
import { chain, isMainnet } from "./chain";
import logo from "./assets/logo.svg";
import styles from "./App.module.css";

export default function App() {
  const { isConnected, restoring } = useSession();
  // The site and its server must be on the same network. If they aren't, say so loudly: money sent from here would go to the wrong place.
  const { chainId: serverChain } = useBackendStatus();
  const chains = useConfig().chains;
  const mismatch = serverChain !== undefined && !chains.some((c) => c.id === serverChain);
  const route = useHashRoute();
  // The pages that need an account show the sign-in page until there is one.
  const gated = !isConnected && route.page !== "home" && route.page !== "receipt";

  return (
    <main className={styles.page}>
      <header className={`${styles.header} ${styles.noPrint}`}>
        <div className={styles.brandGroup}>
          <a className={`${styles.brand} ${styles.brandLink}`} href="#/" aria-label="Home">
            <img src={logo} alt="" className={styles.logo} />
            <h1>Squirrel</h1>
          </a>
          {!isMainnet && <span className={styles.networkPill} title={`${chain.name}: the money here is not real`}>Test network</span>}
        </div>
        <div className={styles.headerRight}>
          {/* Every page needs a sign-in, so until then there is nowhere else to go. Someone coming back keeps the links while the wallet starts. */}
          {(isConnected || restoring) && (
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
          )}
          <div className={styles.account}>
            <ThemeToggle />
            <ProfileMenu hideSignIn={gated} />
          </div>
        </div>
      </header>
      {mismatch && (
        <p className={styles.mismatch} role="alert">
          This site is on {chain.name}, but its server is on chain {serverChain}. Don&apos;t send money until that is fixed.
        </p>
      )}
      {route.page === "home" && <Landing />}
      {route.page === "receipt" && <ReceiptPage jobId={route.jobId} milestone={route.milestone} />}
      {gated && <SignInGate page={route.page as "new" | "jobs" | "flow"} checking={restoring} />}
      {isConnected && route.page === "flow" && <FlowPage jobId={route.jobId} />}
      {isConnected && route.page === "new" && <NewJobPage />}
      {isConnected && route.page === "jobs" && <JobsPage jobId={route.jobId} />}
    </main>
  );
}

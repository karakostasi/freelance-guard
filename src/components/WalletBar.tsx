import { useState } from "react";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { formatEther } from "viem";
import { short } from "../lib/jobs";
import styles from "../App.module.css";

// Deterministic gradient so each account gets its own recognisable avatar.
const avatarGradient = (address: string) => {
  const h1 = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = parseInt(address.slice(-6), 16) % 360;
  return `linear-gradient(135deg, hsl(${h1} 80% 60%), hsl(${h2} 80% 50%))`;
};

export function WalletBar() {
  const { address, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  const [copied, setCopied] = useState(false);

  if (!address) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={styles.walletBar}>
      <button className={styles.walletInfo} onClick={copy} title="Copy address">
        <span className={styles.avatar} style={{ background: avatarGradient(address) }} />
        <span className={styles.walletText}>
          <span className={styles.walletAddress}>{copied ? "Copied!" : short(address)}</span>
          <span className={styles.muted}>
            {balance ? `${Number(formatEther(balance.value)).toFixed(4)} ${balance.symbol}` : "…"}
            {chain && ` · ${chain.name}`}
          </span>
        </span>
      </button>
      <button className={styles.ghostButton} onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}

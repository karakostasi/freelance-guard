import { useState } from "react";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { formatEther } from "viem";
import { Repeat } from "lucide-react";
import { short } from "../lib/jobs";
import styles from "../App.module.css";

// Deterministic gradient so each account gets its own recognisable avatar.
const avatarGradient = (address: string) => {
  const h1 = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = parseInt(address.slice(-6), 16) % 360;
  return `linear-gradient(135deg, hsl(${h1} 80% 60%), hsl(${h2} 80% 50%))`;
};

export function WalletBar() {
  const { address, chain, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  const [copied, setCopied] = useState(false);

  if (!address) return null;

  // MetaMask only reports accounts the site is connected to. This reopens its account picker so
  // another account can be added, and wagmi follows the switch.
  const switchAccount = async () => {
    try {
      const provider = (await connector?.getProvider()) as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined;
      await provider?.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    } catch {
      // the user closed the picker
    }
  };

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
      <div className={styles.walletActions}>
        <button className={styles.ghostButton} onClick={switchAccount} title="Choose which account this site uses">
          <Repeat size={14} /> Switch account
        </button>
        <button className={styles.ghostButton} onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

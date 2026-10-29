import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { formatEther } from "viem";
import { Check, Copy, Landmark, LogOut, Mail, Repeat } from "lucide-react";
import { avatarGradient } from "../lib/avatar";
import { short } from "../lib/jobs";
import { NotificationSettings } from "./NotificationSettings";
import { PayoutSettings } from "./PayoutSettings";
import { SignInButton } from "./SignInButton";
import styles from "../App.module.css";

/** The account in the header: the sign-in button, or the account avatar with a menu. `hideSignIn` leaves it out when the page has its own. */
export function ProfileMenu({ hideSignIn = false }: { hideSignIn?: boolean }) {
  const { address, chain, connector, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  // Where the menu opens (under the avatar); null while it is closed.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [payout, setPayout] = useState(false);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAnchor(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchor]);

  if (!isConnected || !address) {
    return hideSignIn ? null : <SignInButton />;
  }

  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // MetaMask only reports accounts the site is connected to. This reopens its account picker so
  // another account can be added, and wagmi follows the switch.
  const switchAccount = async () => {
    setAnchor(null);
    try {
      const provider = (await connector?.getProvider()) as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined;
      await provider?.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    } catch {
      // the user closed the picker
    }
  };

  // The header clips anything below it, so the menu is drawn outside it, anchored under the avatar.
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor((a) => (a ? null : { top: rect.bottom + 8, right: window.innerWidth - rect.right }));
  };

  return (
    <>
      <button
        className={styles.profileButton}
        style={{ background: avatarGradient(address) }}
        onClick={toggle}
        aria-label="Account menu"
        aria-expanded={!!anchor}
        title={short(address)}
      />
      {anchor &&
        createPortal(
          <div className={styles.menuBackdrop} onClick={() => setAnchor(null)}>
            <div className={styles.menu} style={{ top: anchor.top, right: anchor.right }} onClick={(e) => e.stopPropagation()} role="menu">
              <div className={styles.menuAccount}>
                <span className={styles.avatar} style={{ background: avatarGradient(address) }} />
                <span className={styles.menuText}>
                  <span className={styles.walletAddress}>{short(address)}</span>
                  <span className={styles.muted}>
                    {balance ? `${Number(formatEther(balance.value)).toFixed(4)} ${balance.symbol}` : "…"}
                    {chain && ` · ${chain.name}`}
                  </span>
                </span>
              </div>
              <button className={styles.menuItem} onClick={copy} role="menuitem">
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied!" : "Copy address"}
              </button>
              <button
                className={styles.menuItem}
                onClick={() => {
                  setAnchor(null);
                  setNotifying(true);
                }}
                role="menuitem"
              >
                <Mail size={15} /> Email notifications
              </button>
              <button
                className={styles.menuItem}
                onClick={() => {
                  setAnchor(null);
                  setPayout(true);
                }}
                role="menuitem"
              >
                <Landmark size={15} /> How I get paid
              </button>
              {connector?.id === "metaMask" && (
                <button className={styles.menuItem} onClick={switchAccount} role="menuitem">
                  <Repeat size={15} /> Switch account
                </button>
              )}
              <button
                className={`${styles.menuItem} ${styles.menuDanger}`}
                onClick={() => {
                  setAnchor(null);
                  disconnect();
                }}
                role="menuitem"
              >
                <LogOut size={15} /> Disconnect
              </button>
            </div>
          </div>,
          document.body,
        )}
      {notifying && createPortal(<NotificationSettings onClose={() => setNotifying(false)} />, document.body)}
      {payout && createPortal(<PayoutSettings onClose={() => setPayout(false)} />, document.body)}
    </>
  );
}

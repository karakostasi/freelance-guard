import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

// wagmi keeps the wallet it last connected in the browser's storage, and takes it up again when the page loads.
const remembered = () => {
  try {
    return !!window.localStorage.getItem("wagmi.recentConnectorId");
  } catch {
    return false;
  }
};

/** How long to wait for a session to come back before showing the way in anyway. */
const GIVE_UP_MS = 8000;

/**
 * Whether someone is signed in, and whether we are still finding out. A person who signed in before comes back signed in,
 * but only once the wallet has started up, which takes a moment (the email wallet starts its SDK first). Until then
 * `restoring` is true, and the page shouldn't treat them as a stranger. Someone who never signed in here isn't kept
 * waiting: there is nothing to restore.
 */
export function useSession() {
  const { isConnected, status } = useAccount();
  const [before] = useState(remembered);
  const [gaveUp, setGaveUp] = useState(false);
  const busy = before && (status === "connecting" || status === "reconnecting");
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setGaveUp(true), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [busy]);
  return { isConnected, restoring: busy && !gaveUp };
}

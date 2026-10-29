import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { CDP_CONNECTOR_ID } from "@coinbase/cdp-wagmi";

/**
 * Whether the wallet is the one made at an email login. It signs by itself, with no prompt, so for those people the
 * backend's wallet sign-in is not a step to show: `start` runs once, as soon as the wallet is there.
 */
export function useEmailWallet(start: () => void) {
  const { address, connector } = useAccount();
  const emailWallet = connector?.id === CDP_CONNECTOR_ID;
  const started = useRef(false);
  useEffect(() => {
    if (!emailWallet || !address || started.current) return;
    started.current = true;
    start();
  }, [emailWallet, address, start]);
  return emailWallet;
}

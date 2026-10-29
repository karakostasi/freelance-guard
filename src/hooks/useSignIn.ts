import { useConnect } from "wagmi";
import { CDP_CONNECTOR_ID } from "@coinbase/cdp-wagmi";
import { cdpConfig } from "../cdp";

/**
 * The two ways in. An email login (Coinbase embedded wallet) makes a wallet for the person, so there is no wallet app to
 * install and no seed phrase. A browser wallet such as MetaMask is for people who already have one.
 */
export function useSignIn() {
  const { connect, connectors, isPending, error } = useConnect();
  const browser = connectors.find((c) => c.id === "metaMask") ?? connectors.find((c) => c.id !== CDP_CONNECTOR_ID);
  return {
    /** Whether the email login is set up (it needs a CDP project id). */
    emailAvailable: !!cdpConfig,
    isPending,
    error: error ? error.message.split("\n")[0] : null,
    withBrowserWallet: (onSuccess?: () => void) => browser && connect({ connector: browser }, { onSuccess }),
  };
}

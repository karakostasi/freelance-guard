import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CDPHooksProvider } from "@coinbase/cdp-hooks";
import { cdpConfig } from "./cdp";
import { config } from "./wagmi";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

const app = (
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);

createRoot(document.getElementById("root")!).render(<StrictMode>{cdpConfig ? <CDPHooksProvider config={cdpConfig}>{app}</CDPHooksProvider> : app}</StrictMode>);

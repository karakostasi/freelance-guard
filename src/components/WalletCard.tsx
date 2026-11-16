import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi } from "viem";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, Copy, DollarSign, Euro, ExternalLink, Info, LoaderCircle, Wallet } from "lucide-react";
import { config } from "../wagmi";
import { onrampApi } from "../lib/api";
import { sessionToken } from "../lib/files";
import { useBackendStatus } from "../hooks/useBackend";
import { contractCall, sendWalletCalls } from "../lib/tx";
import { useWalletAssets, type Asset } from "../hooks/useWalletAssets";
import { avatarGradient } from "../lib/avatar";
import { euro, short, txUrl } from "../lib/jobs";
import { checkSend, maxSendable } from "../lib/send";
import { formatBalance, toEur } from "../lib/tokens";
import { isMainnet } from "../chain";
import styles from "../App.module.css";

type View = "assets" | "send" | "receive";
type Stage = "form" | "review" | "confirm" | "pending" | "done";

const BADGE_COLOR: Record<string, string> = { ETH: "#627eea", EURC: "#2775ca", USDC: "#2775ca" };

const BUY = [
  { asset: "EURC", name: "Euro", Icon: Euro },
  { asset: "USDC", name: "US dollar", Icon: DollarSign },
] as const;

const AssetIcon = ({ symbol }: { symbol: string }) => (
  <span className={styles.wpIcon} style={{ background: BADGE_COLOR[symbol] ?? "#555" }}>
    {symbol[0]}
  </span>
);

function Assets({ assets }: { assets: Asset[] }) {
  return (
    <ul className={styles.wpAssets}>
      {assets.map(({ token, units }) => (
        <li key={token.symbol} className={styles.wpAsset}>
          <AssetIcon symbol={token.symbol} />
          <span className={styles.wpAssetName}>
            <strong>{token.symbol}</strong>
            <span className={styles.muted}>{token.address ? "Token" : "Native coin"}</span>
          </span>
          <span className={styles.wpAssetAmount}>
            <strong>{formatBalance(units, token.decimals)}</strong>
            <span className={styles.muted}>{token.eurPer > 0 ? `≈ ${euro(toEur(token, units))}` : ""}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Send({ assets, from }: { assets: Asset[]; from: string }) {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState("ETH");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);

  const asset = assets.find((a) => a.token.symbol === symbol) ?? assets[0];
  const { token, units: balance } = asset;
  const check = checkSend({ to, from, amountText: amount, decimals: token.decimals, symbol: token.symbol, balance, isNative: !token.address });

  const send = async () => {
    setError(null);
    setStage("confirm");
    let submitted = false;
    try {
      const target = to.trim() as `0x${string}`;
      const sent = await sendWalletCalls([token.address ? contractCall({ address: token.address, abi: erc20Abi, functionName: "transfer", args: [target, check.units] }) : { to: target, value: check.units }]);
      submitted = true;
      setHash(sent);
      setStage("pending");
      const receipt = await waitForTransactionReceipt(config, { hash: sent });
      if (receipt.status !== "success") throw new Error("The transaction failed on-chain.");
      setStage("done");
      queryClient.invalidateQueries();
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
      // Rejected in the wallet: back to the review. Sent but failed on-chain: back to the form.
      setStage(submitted ? "form" : "review");
    }
  };

  if (stage === "done") {
    return (
      <div className={styles.wpSection}>
        <p className={styles.wpSuccess}>
          <Check size={18} /> Sent {amount} {token.symbol}
        </p>
        <p className={styles.muted}>To {short(to.trim())}</p>
        {hash && (
          <a className={styles.wpLink} href={txUrl(hash)} target="_blank" rel="noreferrer noopener">
            View the transaction <ExternalLink size={12} />
          </a>
        )}
        <button
          className={styles.button}
          onClick={() => {
            setTo("");
            setAmount("");
            setHash(undefined);
            setStage("form");
          }}
        >
          Send another
        </button>
      </div>
    );
  }

  if (stage !== "form") {
    const waiting = stage === "confirm" || stage === "pending";
    return (
      <div className={styles.wpSection}>
        <h3 className={styles.groupTitle}>Review</h3>
        <div className={styles.wpReview}>
          <span className={styles.muted}>You send</span>
          <strong className={styles.wpBig}>
            {amount} {token.symbol}
          </strong>
          <span className={styles.muted}>To</span>
          <span className={styles.wpFullAddress}>{to.trim()}</span>
        </div>
        <p className={styles.muted}>Sending is final. Check the address carefully, because a wrong one can't be undone.</p>
        {waiting ? (
          <p className={styles.wpWaiting}>
            <LoaderCircle size={16} className={styles.wpSpin} /> {stage === "confirm" ? "Confirm in your wallet…" : "Waiting for the transaction to confirm…"}
          </p>
        ) : (
          <div className={styles.wpRow}>
            <button className={styles.ghostButton} onClick={() => setStage("form")}>
              Back
            </button>
            <button className={styles.button} onClick={send}>
              Confirm and send
            </button>
          </div>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  const shown = to.trim() !== "" || amount.trim() !== "" ? check.error : null;
  return (
    <div className={styles.wpSection}>
      <select className={styles.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Asset to send">
        {assets.map((a) => (
          <option key={a.token.symbol} value={a.token.symbol}>
            {a.token.symbol} · {formatBalance(a.units, a.token.decimals)} available
          </option>
        ))}
      </select>
      <input className={styles.input} placeholder="Send to (0x…)" value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} autoComplete="off" />
      <div className={styles.suffixField}>
        <input className={styles.input} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        <button
          type="button"
          className={styles.wpMax}
          onClick={() => setAmount(formatBalance(maxSendable(balance, !token.address), token.decimals).replace("< ", "0"))}
          disabled={maxSendable(balance, !token.address) === 0n}
        >
          Max
        </button>
      </div>
      {!token.address && <span className={styles.muted}>Max leaves a little ETH for the network fee.</span>}
      {shown && <span className={styles.error}>{shown}</span>}
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} disabled={!!check.error} onClick={() => setStage("review")}>
        Review
      </button>
    </div>
  );
}

function Receive({ address, network }: { address: string; network: string }) {
  const [copied, setCopied] = useState(false);
  const { onramp } = useBackendStatus();
  const [buying, setBuying] = useState<"EURC" | "USDC" | null>(null);
  const [pick, setPick] = useState<"EURC" | "USDC">("EURC");
  const [buyError, setBuyError] = useState<string | null>(null);
  const buy = async (asset: "EURC" | "USDC") => {
    setBuying(asset);
    setBuyError(null);
    // Opened first, while the click still counts, so the browser doesn't block it. It is pointed at Coinbase once we have the address.
    const tab = window.open("", "_blank");
    try {
      const { url } = await onrampApi.buy(await sessionToken(address), asset);
      if (tab) {
        tab.opener = null;
        tab.location.assign(url);
      } else window.location.assign(url);
    } catch (e) {
      tab?.close();
      setBuyError((e as Error).message);
    } finally {
      setBuying(null);
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={styles.wpSection}>
      <div className={styles.wpAddressCard}>
        <h3 className={styles.groupTitle}>
          <Wallet size={14} aria-hidden /> Your address
        </h3>
        {/* The start and end are what people check, so they are the heavy part. The text stays one string for copying and screen readers. */}
        <span className={styles.wpFullAddress}>
          <strong>{address.slice(0, 6)}</strong>
          {address.slice(6, -4)}
          <strong>{address.slice(-4)}</strong>
        </span>
        <button className={`${styles.button} ${styles.wpCopy}`} onClick={copy}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? "Copied!" : "Copy address"}
        </button>
        <p className={styles.wpNote}>
          <Info size={14} aria-hidden /> Only send assets on {network} to this address.
        </p>
      </div>

      {onramp && (
        <div className={styles.wpBuyCard}>
          <h3 className={styles.groupTitle}>Buy with Coinbase</h3>
          <div className={styles.wpBuyGrid} role="group" aria-label="Coin to buy">
            {BUY.map(({ asset, name, Icon }) => (
              <button key={asset} className={`${styles.wpBuyTile} ${pick === asset ? styles.wpBuyOn : ""}`} disabled={!!buying} aria-pressed={pick === asset} onClick={() => setPick(asset)}>
                {pick === asset && <Check size={14} className={styles.wpBuyCheck} aria-hidden />}
                <span className={styles.wpBuyIcon}>
                  <Icon size={20} aria-hidden />
                </span>
                <strong>{asset}</strong>
                <span className={styles.muted}>{name}</span>
              </button>
            ))}
          </div>
          <button className={`${styles.button} ${styles.wpCopy}`} disabled={!!buying} onClick={() => buy(pick)}>
            {buying ? <LoaderCircle size={16} className={styles.wpSpin} aria-hidden /> : null} {buying ? "Opening…" : `Buy ${pick}`}
          </button>
          <p className={styles.muted}>You sign in to Coinbase and pay there. The coins arrive at your address above, on Base mainnet{isMainnet ? "." : ", not on this test network: it is real money."}</p>
          {buyError && <p className={styles.error}>{buyError}</p>}
        </div>
      )}

      {!isMainnet && (
        <>
          <h3 className={styles.groupTitle}>Get test funds</h3>
          <p className={styles.muted}>This is a test network, so funds are free from a faucet.</p>
          <a className={styles.wpLink} href="https://portal.cdp.coinbase.com/products/faucet" target="_blank" rel="noreferrer noopener">
            Coinbase faucet: test ETH, USDC and EURC <ExternalLink size={12} />
          </a>
          <a className={styles.wpLink} href="https://faucet.circle.com" target="_blank" rel="noreferrer noopener">
            Circle faucet: test USDC and EURC <ExternalLink size={12} />
          </a>
        </>
      )}
    </div>
  );
}

/** The wallet, always visible beside the page: balances, send, and how to receive or get test funds. */
export function WalletCard({ className }: { className?: string }) {
  const { address, chain } = useAccount();
  const { assets, loaded } = useWalletAssets();
  const [view, setView] = useState<View>("assets");

  if (!address) return null;
  const total = assets.reduce((sum, a) => sum + (a.token.eurPer > 0 ? toEur(a.token, a.units) : 0), 0);

  return (
    <aside className={`${styles.wpCard} ${className ?? ""}`} aria-label="Wallet">
      <div className={styles.wpHeader}>
        <span className={styles.avatar} style={{ background: avatarGradient(address) }} />
        <span className={styles.wpWho}>
          <strong className={styles.walletAddress} title={address}>
            {short(address)}
          </strong>
          <span className={styles.muted}>{chain?.name ?? "No network"}</span>
        </span>
      </div>

      {/* A total in euros needs a rate for every token. The rates here are invented, so on the real network there is no total. */}
      {!isMainnet && (
        <div className={styles.wpTotal}>
          <span className={styles.muted}>Total balance</span>
          <strong className={styles.wpTotalValue}>{loaded ? euro(total) : "…"}</strong>
          <span className={styles.muted}>at the app's demo rates</span>
        </div>
      )}

      <div className={styles.wpActions}>
        <button className={`${styles.wpAction} ${view === "send" ? styles.wpActionOn : ""}`} onClick={() => setView(view === "send" ? "assets" : "send")} aria-pressed={view === "send"}>
          <span className={styles.wpActionIcon}>
            <ArrowUpRight size={18} />
          </span>
          Send
        </button>
        <button className={`${styles.wpAction} ${view === "receive" ? styles.wpActionOn : ""}`} onClick={() => setView(view === "receive" ? "assets" : "receive")} aria-pressed={view === "receive"}>
          <span className={styles.wpActionIcon}>
            <ArrowDownLeft size={18} />
          </span>
          Receive
        </button>
      </div>

      {view !== "assets" && (
        <button className={styles.wpBack} onClick={() => setView("assets")}>
          <ArrowLeft size={14} /> Back to assets
        </button>
      )}
      {view === "assets" && <Assets assets={assets} />}
      {view === "send" && <Send assets={assets} from={address} />}
      {view === "receive" && <Receive address={address} network={chain?.name ?? "this network"} />}
    </aside>
  );
}

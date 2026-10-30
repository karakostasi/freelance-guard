// What it takes to run this server with real money. On a test network nothing here gets in the way. On any other network,
// or when STRICT=1 (to rehearse it on a test network), the server refuses to start unless everything below is in order, and
// the sandbox parts (the bank, the mint) stay shut. Nothing here can be switched off: the checks only ever add rules.

/** Networks where the money is play money: a local chain, Base Sepolia and Ethereum Sepolia. */
export const TEST_CHAINS = new Set([31337, 84532, 11155111]);

/** The tokens we accept on a real network. Nothing else, so a wrong address in a setting can't send money to a fake token. */
export const CANONICAL_TOKENS = {
  // Base: Circle's own USDC and EURC.
  8453: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" },
};

const WEAK_SECRETS = new Set(["", "change-me", "changeme", "dev-webhook-secret", "secret", "test-secret"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const sameAddress = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** The chain the operator says this server is for, or null. */
export const intendedChain = (env) => (env.EXPECTED_CHAIN_ID ? Number(env.EXPECTED_CHAIN_ID) : null);

/**
 * Whether the rules for real money apply: the chain is not a test chain, the operator says it is meant for one, or STRICT=1.
 * An unknown chain counts as real, and so does a chain we couldn't read when the operator named a real one.
 */
export function isStrict({ env, chainId }) {
  const intended = intendedChain(env);
  return env.STRICT === "1" || (chainId !== null && !TEST_CHAINS.has(chainId)) || (intended !== null && !TEST_CHAINS.has(intended));
}

/** What is wrong with the settings, in words. Empty when there is nothing to say, or when the rules don't apply. */
export function startupProblems({ env, chainId }) {
  if (!isStrict({ env, chainId })) return [];
  const problems = [];
  const intended = intendedChain(env);
  const onTestChain = chainId !== null && TEST_CHAINS.has(chainId);

  if (chainId === null) problems.push("The RPC didn't answer, so the network can't be checked. Check RPC_URL.");
  if (intended === null || !Number.isInteger(intended)) problems.push("Set EXPECTED_CHAIN_ID (for Base mainnet, 8453), so a wrong RPC_URL can't point this server at another network.");
  else if (chainId !== null && chainId !== intended) problems.push(`RPC_URL is on chain ${chainId}, but EXPECTED_CHAIN_ID says ${intended}.`);

  if (!env.ESCROW_ADDRESS || !ADDRESS.test(env.ESCROW_ADDRESS)) problems.push("Set ESCROW_ADDRESS to the deployed escrow (VITE_ESCROW_ADDRESS isn't used on a real network).");
  if (!env.RPC_URL) problems.push("Set RPC_URL. The default is a public test network.");
  if (env.MINT_PRIVATE_KEY) problems.push("MINT_PRIVATE_KEY is set. That key creates play money and has no place on a real network. Remove it.");

  const secret = (name) => {
    const v = env[name] ?? "";
    if (WEAK_SECRETS.has(v) || v.length < 32) problems.push(`${name} must be a random value of at least 32 characters (try: openssl rand -hex 32).`);
    return v;
  };
  const webhook = secret("WEBHOOK_SECRET");
  const session = secret("SESSION_SECRET");
  if (webhook && webhook === session) problems.push("SESSION_SECRET and WEBHOOK_SECRET must be different values.");

  const origins = (env.CORS_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (origins.length === 0) problems.push("Set CORS_ORIGIN to the address of the site. Left empty it lets any website call this server.");
  for (const origin of origins) {
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (origin === "*" || !(origin.startsWith("https://") || (onTestChain && local))) problems.push(`CORS_ORIGIN "${origin}" must be an https:// address.`);
  }
  for (const name of ["APP_URL", "PUBLIC_API_URL"]) {
    const v = env[name] ?? "";
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(v);
    if (!v || !(v.startsWith("https://") || (onTestChain && local))) problems.push(`Set ${name} to an https:// address: it is in the links of the emails.`);
  }
  if (!env.DATABASE_URL && env.ALLOW_FILE_DB !== "1") problems.push("Set DATABASE_URL. A file on the server's disk is lost on a redeploy (ALLOW_FILE_DB=1 accepts that on purpose).");

  // Tokens: if they are set at all they must be the real ones, and we must know the real ones for this network.
  if (chainId !== null && !onTestChain) {
    const known = CANONICAL_TOKENS[chainId];
    if (!known) problems.push(`There are no known tokens for chain ${chainId}. Real money is only set up for: ${Object.keys(CANONICAL_TOKENS).join(", ")}.`);
    else
      for (const symbol of ["USDC", "EURC"]) {
        const v = env[`${symbol}_ADDRESS`];
        if (v && !sameAddress(v, known[symbol])) problems.push(`${symbol}_ADDRESS is ${v}, which is not Circle's ${symbol} on chain ${chainId} (${known[symbol]}). Leave it empty.`);
      }
  }
  return problems;
}

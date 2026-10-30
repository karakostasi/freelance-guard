// The rules for putting the escrow on a network where the money is real, as plain functions that can be tested. The script
// that deploys (scripts/deploy-mainnet.cjs) and the one that checks a deployment (scripts/check-deployment.cjs) both use them.
//
// The ideas:
//  - The deploying key holds nothing. The owner is given to the constructor, so there is no moment when a key on a laptop
//    owns the escrow. The owner is a multisig, and so is the arbiter (which can never be changed).
//  - Nothing is guessed. Every limit and address is named on purpose, and the tokens are Circle's and nothing else.
//  - Nothing is sent unless it is asked for twice: EXECUTE=1 and the chain id typed in.

const ZERO = "0x0000000000000000000000000000000000000000";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^\d+(\.\d{1,6})?$/;

/** The networks this can deploy to. `real` ones have the strict rules. The test ones are for rehearsing the same steps. */
const NETWORKS = {
  base: {
    chainId: 8453,
    real: true,
    tokens: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" },
  },
  baseSepolia: {
    chainId: 84532,
    real: false,
    tokens: { USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", EURC: "0x808456652fdb597867f38412077A9182bf77359F" },
  },
  // For the tests of this very script: the tokens are whatever the test deployed.
  localhost: { chainId: 31337, real: false, tokens: null },
};

const SYMBOLS = ["USDC", "EURC"];
const DEFAULT_SURCHARGE_BPS = 25;
const MAX_SURCHARGE_BPS = 100; // the contract's own limit
const MIN_REVIEW_DAYS = 1;
const MAX_REVIEW_DAYS = 14;

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Whole units of a token ("40", "2000.5") as base units, six decimals, without floating point. */
function units(text) {
  const [whole, frac = ""] = String(text).split(".");
  return BigInt(whole) * 10n ** 6n + BigInt(frac.padEnd(6, "0"));
}

/**
 * Checks what was asked for and returns what would be deployed. `deployer` is the key that will send the transactions.
 * Nothing here talks to the network: the checks that need it are in the script.
 */
function planDeployment(env, network, deployer) {
  const errors = [];
  const warnings = [];
  const rules = NETWORKS[network];
  if (!rules) {
    errors.push(`"${network}" isn't a network this deploys to. Use --network base (real money) or --network baseSepolia (a rehearsal).`);
    return { errors, warnings, plan: null };
  }
  // STRICT=1 holds a rehearsal to the rules of real money. Nothing turns them off.
  const real = rules.real || env.STRICT === "1";

  const address = (name) => {
    const v = env[name];
    if (!v || !ADDRESS.test(v) || v.toLowerCase() === ZERO) {
      errors.push(`Set ${name} to an address.`);
      return null;
    }
    return v;
  };
  const owner = address("OWNER_ADDRESS");
  const arbiter = address("ARBITER_ADDRESS");
  const treasury = address("TREASURY_ADDRESS");

  // Separation of duties: nobody who could change the rules is also the one who decides disputes, and the key that deploys
  // holds no role at all.
  if (owner && arbiter && same(owner, arbiter)) errors.push("OWNER_ADDRESS and ARBITER_ADDRESS must be different: whoever changes the rules shouldn't decide the disputes.");
  if (deployer) {
    for (const [name, v] of [["OWNER_ADDRESS", owner], ["ARBITER_ADDRESS", arbiter], ["TREASURY_ADDRESS", treasury]]) {
      if (v && same(v, deployer)) errors.push(`${name} is the deploying key. It must hold no role: the key that deploys is on a laptop, the roles are for multisigs.`);
    }
  }

  // The review period can never be changed after the deploy.
  const days = Number(env.REVIEW_PERIOD_DAYS);
  if (!env.REVIEW_PERIOD_DAYS || !Number.isInteger(days) || days < MIN_REVIEW_DAYS || days > MAX_REVIEW_DAYS) errors.push(`Set REVIEW_PERIOD_DAYS to a whole number of days, ${MIN_REVIEW_DAYS} to ${MAX_REVIEW_DAYS}. It can't be changed afterwards.`);

  const surchargeBps = env.SURCHARGE_BPS === undefined || env.SURCHARGE_BPS === "" ? DEFAULT_SURCHARGE_BPS : Number(env.SURCHARGE_BPS);
  if (!Number.isInteger(surchargeBps) || surchargeBps < 0 || surchargeBps > MAX_SURCHARGE_BPS) errors.push(`SURCHARGE_BPS must be a whole number from 0 to ${MAX_SURCHARGE_BPS}.`);

  // The tokens: Circle's, and only if you don't say otherwise in a way that differs.
  const tokens = {};
  for (const symbol of SYMBOLS) {
    const given = env[`${symbol}_ADDRESS`];
    let tokenAddress = rules.tokens?.[symbol] ?? null;
    if (given) {
      if (!ADDRESS.test(given)) errors.push(`${symbol}_ADDRESS isn't an address.`);
      else if (tokenAddress && !same(given, tokenAddress)) errors.push(`${symbol}_ADDRESS is ${given}, which is not Circle's ${symbol} on ${network} (${tokenAddress}). Leave it empty.`);
      else tokenAddress = given;
    }
    if (!tokenAddress) errors.push(`Set ${symbol}_ADDRESS (there is no known ${symbol} for ${network}).`);

    // What the smallest fee and the smallest job are, in whole tokens. Named, not computed from an exchange rate.
    const minFee = env[`${symbol}_MIN_FEE`];
    const minJob = env[`${symbol}_MIN_JOB`];
    let cfg = null;
    if (!minFee || !DECIMAL.test(minFee) || !minJob || !DECIMAL.test(minJob)) errors.push(`Set ${symbol}_MIN_FEE and ${symbol}_MIN_JOB, in whole ${symbol} (for example 40 and 2000).`);
    else {
      const fee = units(minFee);
      const job = units(minJob);
      if (job === 0n || fee === 0n) errors.push(`${symbol}_MIN_FEE and ${symbol}_MIN_JOB must be above zero.`);
      else if (fee > job / 20n) errors.push(`${symbol}_MIN_FEE can't be more than 5% of ${symbol}_MIN_JOB: the contract refuses it, so a wrong value can't eat a payment.`);
      else cfg = { enabled: true, surchargeBps, minFee: fee, minJob: job, vault: ZERO };
    }
    tokens[symbol] = { address: tokenAddress, cfg };
  }

  // What is not done here, on purpose.
  for (const name of Object.keys(env)) if (/^MOCK_/.test(name) && env[name]) errors.push(`${name} is set. Mock tokens are for test networks and deploy.cjs, not this.`);
  if (env.USDC_VAULT_ADDRESS) errors.push("USDC_VAULT_ADDRESS is set. This never sets a vault: yield is switched on later, by the multisig, after the legal opinion and the audit.");

  const execute = env.EXECUTE === "1";
  if (execute && real && String(env.CONFIRM_CHAIN_ID) !== String(rules.chainId)) errors.push(`To send for real, also set CONFIRM_CHAIN_ID=${rules.chainId}. It is a typed-in check that you meant this network.`);

  if (!real) warnings.push(`${network} is not a real-money network: this is a rehearsal, and some checks are lighter.`);
  if (treasury && owner && same(treasury, owner)) warnings.push("The treasury is the owner's address. That is allowed, but fees and rules then sit behind the same keys.");

  const plan = errors.length
    ? null
    : {
        network,
        chainId: rules.chainId,
        real,
        execute,
        owner,
        arbiter,
        treasury,
        reviewPeriodSeconds: days * 86400,
        reviewPeriodDays: days,
        surchargeBps,
        tokens,
      };
  return { errors, warnings, plan };
}

/** What a Safe batch (the Transaction Builder of Safe) should do once the escrow exists: switch the tokens on. */
function safeBatch({ chainId, escrow, calls, createdAt }) {
  return {
    version: "1.0",
    chainId: String(chainId),
    createdAt,
    meta: { name: "Squirrel: switch on the tokens", description: "configureToken for each token, from the owner. Review every value before signing." },
    transactions: calls.map((c) => ({ to: escrow, value: "0", data: c.data, contractMethod: null, contractInputsValues: null, description: c.description })),
  };
}

module.exports = { NETWORKS, SYMBOLS, ZERO, planDeployment, safeBatch, units, same };

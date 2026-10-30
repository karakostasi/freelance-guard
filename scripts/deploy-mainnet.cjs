// Deploys the escrow to a network with real money (--network base), or rehearses the same steps on a test network
// (--network baseSepolia). It is not scripts/deploy.cjs, which is for play money and sets everything up from one key.
//
// By default it only CHECKS and prints what it would do. It sends nothing until EXECUTE=1 and CONFIRM_CHAIN_ID are set.
// Read docs/mainnet.md first. The rules it enforces are in scripts/lib/mainnet-plan.cjs.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const hre = require("hardhat");
const { ethers } = hre;
const { NETWORKS, SYMBOLS, planDeployment, safeBatch, same } = require("./lib/mainnet-plan.cjs");

const SAFE_ABI = ["function VERSION() view returns (string)", "function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"];
const TOKEN_ABI = ["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"];

const out = (line = "") => console.log(line);
const die = (lines) => {
  for (const l of [].concat(lines)) console.error(` - ${l}`);
  process.exit(1);
};
const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

/** What a Safe says about itself, or null if it doesn't answer like one. */
async function readSafe(address) {
  try {
    const safe = new ethers.Contract(address, SAFE_ABI, ethers.provider);
    const [version, owners, threshold] = await Promise.all([safe.VERSION(), safe.getOwners(), safe.getThreshold()]);
    return { version, owners: [...owners], threshold: Number(threshold) };
  } catch {
    return null;
  }
}

async function main() {
  const network = hre.network.name;
  const rules = NETWORKS[network];
  if (!rules) die(`"${network}" isn't a network this deploys to. Use --network base (real money) or --network baseSepolia (a rehearsal).`);
  // STRICT=1 holds a rehearsal to the rules of real money. Nothing turns them off.
  const real = rules.real || process.env.STRICT === "1";
  // A clean working tree is only demanded on the real network, where the code has to be findable again from its commit.
  const mustBeClean = rules.real;

  // The network and the key, before anything else.
  if (network === "base" && !process.env.BASE_RPC_URL) die("Set BASE_RPC_URL to your own Base mainnet RPC. There is no default, so a public one can't be picked by accident.");
  const { chainId } = await ethers.provider.getNetwork();
  if (Number(chainId) !== rules.chainId) die(`The RPC answers as chain ${chainId}, but ${network} is chain ${rules.chainId}. Check the RPC URL.`);
  const [deployer] = await ethers.getSigners();
  if (!deployer) die(network === "base" ? "Set MAINNET_DEPLOYER_PRIVATE_KEY: a key made for this and nothing else. The test network's key isn't used here." : "Set DEPLOYER_PRIVATE_KEY.");

  // The rules that need nothing from the chain.
  const { errors, warnings, plan } = planDeployment(process.env, network, deployer.address);
  if (!plan) die(errors);

  // The rules that do.
  const problems = [];
  const notes = [];
  const safes = {};
  for (const role of ["owner", "arbiter"]) {
    const address = plan[role];
    if ((await ethers.provider.getCode(address)) === "0x") {
      (real ? problems : notes).push(`${role} ${address} is not a contract. It has to be a multisig (a Safe).`);
      continue;
    }
    const safe = await readSafe(address);
    safes[role] = safe;
    if (!safe) {
      if (real || process.env.ALLOW_NON_SAFE !== "1") problems.push(`${role} ${address} doesn't answer like a Safe (VERSION, getOwners, getThreshold).`);
      continue;
    }
    const lowest = real ? Math.max(2, Number(process.env.MIN_SAFE_THRESHOLD ?? 2)) : 1;
    if (safe.threshold < lowest) problems.push(`The ${role} Safe needs ${lowest} signatures at least, and it needs ${safe.threshold}.`);
    if (real && safe.owners.length < 3) problems.push(`The ${role} Safe has ${safe.owners.length} signers. Use at least 3, with a threshold below the number of signers, so losing one key doesn't lock it.`);
    if (real && safe.threshold >= safe.owners.length) problems.push(`The ${role} Safe needs all of its ${safe.owners.length} signers. Lower the threshold, so that one lost key doesn't lock it forever.`);
    if (safe.owners.some((o) => same(o, deployer.address))) problems.push(`The deploying key is a signer of the ${role} Safe. Take it out: it is the key most exposed.`);
  }
  if (safes.owner && safes.arbiter) {
    const shared = safes.owner.owners.filter((o) => safes.arbiter.owners.some((a) => same(a, o)));
    if (shared.length > 0) (real ? problems : notes).push(`These sign for both the owner and the arbiter: ${shared.join(", ")}. Whoever changes the rules shouldn't also decide disputes.`);
  }
  if ((await ethers.provider.getCode(plan.treasury)) === "0x") warnings.push("The treasury is a plain key, not a multisig. Fees will be sent to it.");

  // The tokens: they must be what we think they are, on this network.
  const tokenInfo = {};
  for (const symbol of SYMBOLS) {
    const address = plan.tokens[symbol].address;
    if ((await ethers.provider.getCode(address)) === "0x") {
      problems.push(`${symbol} ${address} has no contract on ${network}.`);
      continue;
    }
    const token = new ethers.Contract(address, TOKEN_ABI, ethers.provider);
    try {
      const [name, onChainSymbol, decimals] = await Promise.all([token.name(), token.symbol(), token.decimals()]);
      tokenInfo[symbol] = { name, symbol: onChainSymbol, decimals: Number(decimals) };
      if (onChainSymbol !== symbol || Number(decimals) !== 6) problems.push(`${address} calls itself ${onChainSymbol} with ${decimals} decimals, and ${symbol} with 6 was expected.`);
    } catch {
      problems.push(`${symbol} ${address} doesn't answer like an ERC-20 token.`);
    }
  }

  // The code that is deployed must be code you can find again.
  const commit = git("rev-parse", "HEAD");
  const dirty = (git("status", "--porcelain") ?? "x") !== "";
  if (mustBeClean && (!commit || dirty)) problems.push("The working tree isn't clean. Commit everything first, so the deployed code can be found again from its commit.");
  else if (dirty) warnings.push("The working tree isn't clean.");

  // One deployment per network, and it can't be overwritten by accident.
  const dir = path.resolve(process.env.DEPLOYMENTS_DIR ?? "deployments");
  const file = path.join(dir, `${network}.json`);
  if (fs.existsSync(file)) problems.push(`${file} exists: this network already has a deployment recorded. Move it away on purpose if you mean to deploy again.`);

  // And the key can pay for it.
  const factory = await ethers.getContractFactory("FreelanceEscrow", deployer);
  const args = [plan.owner, plan.arbiter, plan.treasury, plan.reviewPeriodSeconds];
  const deployTx = await factory.getDeployTransaction(...args);
  const gas = await ethers.provider.estimateGas({ ...deployTx, from: deployer.address });
  const fees = await ethers.provider.getFeeData();
  const price = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance < gas * price * 2n) problems.push(`The deploying key has ${ethers.formatEther(balance)} ETH, and the deploy costs about ${ethers.formatEther(gas * price)}. Send it some more (a little more than double).`);

  // What it is about to do.
  const settings = hre.config.solidity.compilers[0].settings;
  out(`\n${plan.execute ? "DEPLOYING" : "DRY RUN"}: the escrow on ${network} (chain ${plan.chainId})${real ? ", REAL MONEY" : ""}`);
  out(`  deploying key   ${deployer.address}  (${ethers.formatEther(balance)} ETH, holds no role)`);
  out(`  owner           ${plan.owner}${safes.owner ? `  Safe ${safes.owner.version}, ${safes.owner.threshold} of ${safes.owner.owners.length}` : ""}`);
  out(`  arbiter         ${plan.arbiter}${safes.arbiter ? `  Safe ${safes.arbiter.version}, ${safes.arbiter.threshold} of ${safes.arbiter.owners.length}` : ""}  (can never be changed)`);
  out(`  treasury        ${plan.treasury}`);
  out(`  review period   ${plan.reviewPeriodDays} days  (can never be changed)`);
  for (const symbol of SYMBOLS) {
    const t = plan.tokens[symbol];
    const info = tokenInfo[symbol];
    out(`  ${symbol}            ${t.address}  ${info ? `"${info.name}", ${info.decimals} decimals` : "NOT CHECKED"}`);
    out(`                  smallest fee ${ethers.formatUnits(t.cfg.minFee, 6)}, smallest job ${ethers.formatUnits(t.cfg.minJob, 6)}, surcharge ${plan.surchargeBps / 100}%, no yield (switched on by the multisig, after the buttons below)`);
  }
  out(`  code            commit ${commit?.slice(0, 10) ?? "?"}${dirty ? " (not clean)" : ""}, optimizer ${settings.optimizer.enabled ? `${settings.optimizer.runs} runs` : "off"}`);
  out(`  cost            about ${ethers.formatEther(gas * price)} ETH`);
  for (const w of warnings) out(`  warning: ${w}`);
  for (const n of notes) out(`  note: ${n}`);

  if (problems.length > 0) {
    console.error("\nNot going ahead:");
    die(problems);
  }
  if (!plan.execute) {
    out("\nNothing was sent. Everything above checks out. To deploy for real, run again with:");
    out(`  EXECUTE=1 ${real ? `CONFIRM_CHAIN_ID=${plan.chainId} ` : ""}npm run ${real ? "deploy:mainnet" : "deploy:rehearsal"}`);
    return;
  }

  // ---------------------------------------------------------------- deploy
  out("\nSending...");
  const escrow = await factory.deploy(...args);
  // On the real network, wait for a second block on top. A local test chain has no more blocks coming, so one has to do there.
  const receipt = await escrow.deploymentTransaction().wait(rules.real ? 2 : 1);
  const address = await escrow.getAddress();
  out(`  deployed at ${address} in block ${receipt.blockNumber}`);

  // Read it all back from the chain: what is there must be what was asked for.
  const wrong = [];
  const expect = (what, got, want) => {
    if (!same(got, want)) wrong.push(`${what} is ${got}, expected ${want}`);
  };
  expect("owner", await escrow.owner(), plan.owner);
  expect("pending owner", await escrow.pendingOwner(), ethers.ZeroAddress);
  expect("arbiter", await escrow.arbiter(), plan.arbiter);
  expect("treasury", await escrow.treasury(), plan.treasury);
  expect("review period", await escrow.reviewPeriod(), BigInt(plan.reviewPeriodSeconds));
  expect("paused", await escrow.paused(), false);
  for (const symbol of SYMBOLS) if ((await escrow.tokenConfig(plan.tokens[symbol].address)).enabled) wrong.push(`${symbol} is already switched on`);
  if (wrong.length > 0) {
    console.error(`\nThe escrow at ${address} is NOT what was asked for. Do not use it:`);
    die(wrong);
  }
  const runtimeCode = await ethers.provider.getCode(address);
  const record = {
    network,
    chainId: plan.chainId,
    address,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    owner: plan.owner,
    arbiter: plan.arbiter,
    treasury: plan.treasury,
    reviewPeriodSeconds: plan.reviewPeriodSeconds,
    surchargeBps: plan.surchargeBps,
    tokens: Object.fromEntries(SYMBOLS.map((s) => [s, { address: plan.tokens[s].address, minFee: plan.tokens[s].cfg.minFee, minJob: plan.tokens[s].cfg.minJob }])),
    code: { gitCommit: commit, gitClean: !dirty, solc: settings.version ?? hre.config.solidity.compilers[0].version, optimizerRuns: settings.optimizer.runs, runtimeCodeHash: ethers.keccak256(runtimeCode) },
  };
  const json = (value) => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, json(record));

  // What the multisig has to do next: switch the tokens on. It is theirs to sign, not this script's.
  const calls = SYMBOLS.map((s) => {
    const t = plan.tokens[s];
    const cfg = [t.cfg.enabled, t.cfg.surchargeBps, t.cfg.minFee, t.cfg.minJob, t.cfg.vault];
    return { description: `configureToken ${s}`, data: escrow.interface.encodeFunctionData("configureToken", [t.address, cfg]) };
  });
  const batchFile = path.join(dir, `${network}.safe-config.json`);
  fs.writeFileSync(batchFile, json(safeBatch({ chainId: plan.chainId, escrow: address, calls, createdAt: Date.now() })));

  out(`\nRecorded in ${file}`);
  out(`The next step belongs to the owner Safe (${plan.owner}): switch the tokens on, from ${batchFile}`);
  out("In the Safe app: New transaction, Transaction Builder, drop the file in. If it isn't taken, send these as custom data to the escrow, one transaction each:");
  for (const c of calls) out(`  ${c.description}: ${c.data}`);
  out("\nThen:");
  out(`  1. Publish the source:   npx hardhat verify --network ${network} ${address} ${plan.owner} ${plan.arbiter} ${plan.treasury} ${plan.reviewPeriodSeconds}`);
  out(`  2. Check what is on-chain:   REQUIRE_CONFIGURED=1 npm run check:deployment${real ? "" : ":rehearsal"}`);
  out("  3. Try it with a very small job, and practise pausing and unpausing from the Safe, before anyone else uses it.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

const hre = require("hardhat");
const { ethers } = hre;

// Demo euro rates, the same as in src/lib/tokens.ts. They only turn the euro limits below into token amounts.
const EUR_PER = { ETH: 2500, USDC: 0.92, EURC: 1 };
const DECIMALS = { ETH: 18, USDC: 6, EURC: 6 };
// Circle's test tokens on Base Sepolia. Override with USDC_ADDRESS and EURC_ADDRESS.
const CIRCLE = { USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", EURC: "0x808456652fdb597867f38412077A9182bf77359F" };

// What a payer pays on top of each milestone, in basis points (0.25%).
const SURCHARGE_BPS = 25;
// Smallest fee and smallest job, in euros. The defaults are small so a demo works with test funds. The launch values
// are 40 and 2000: set MIN_FEE_EUR=40 and MIN_JOB_EUR=2000.
const MIN_FEE_EUR = Number(process.env.MIN_FEE_EUR ?? 1);
const MIN_JOB_EUR = Number(process.env.MIN_JOB_EUR ?? 20);

const units = (eur, symbol) => ethers.parseUnits((eur / EUR_PER[symbol]).toFixed(6), DECIMALS[symbol]);

async function main() {
  const [deployer] = await ethers.getSigners();
  const reviewPeriod = 3 * 24 * 3600; // 3 days
  // Owner, arbiter and treasury default to the deployer. Set trusted addresses for real use.
  const arbiter = process.env.ARBITER_ADDRESS || deployer.address;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  // The deployer owns the escrow while it is set up. A different OWNER_ADDRESS is handed the ownership at the end.
  const escrow = await ethers.deployContract("FreelanceEscrow", [deployer.address, arbiter, treasury, reviewPeriod]);
  await escrow.waitForDeployment();
  console.log("FreelanceEscrow deployed to", await escrow.getAddress());
  const receipt = await escrow.deploymentTransaction().wait();

  const tokens = { ETH: ethers.ZeroAddress, USDC: process.env.USDC_ADDRESS || CIRCLE.USDC, EURC: process.env.EURC_ADDRESS || CIRCLE.EURC };
  // Local chains have no real stablecoins, so deploy mock ones to test token jobs with.
  if (["hardhat", "localhost"].includes(hre.network.name)) {
    for (const symbol of ["EURC", "USDC"]) {
      const mock = await ethers.deployContract("MockERC20", [`Mock ${symbol}`, symbol, 6]);
      await mock.waitForDeployment();
      tokens[symbol] = await mock.getAddress();
      console.log(`Mock ${symbol} deployed to`, tokens[symbol], `(set VITE_${symbol}_ADDRESS and ${symbol}_ADDRESS to this; mint with ${symbol.toLowerCase()}.mint)`);
    }
  }

  // Only these tokens can be used for jobs. The smallest fee can't be more than 5% of the smallest job.
  for (const [symbol, address] of Object.entries(tokens)) {
    const minJob = units(MIN_JOB_EUR, symbol);
    const minFee = [units(MIN_FEE_EUR, symbol), minJob / 20n].reduce((a, b) => (a < b ? a : b));
    await (await escrow.configureToken(address, { enabled: true, surchargeBps: SURCHARGE_BPS, minFee, minJob })).wait();
    console.log(`Enabled ${symbol}: fee at least ${ethers.formatUnits(minFee, DECIMALS[symbol])}, job at least ${ethers.formatUnits(minJob, DECIMALS[symbol])}`);
  }

  if (process.env.OWNER_ADDRESS && process.env.OWNER_ADDRESS !== deployer.address) {
    await (await escrow.transferOwnership(process.env.OWNER_ADDRESS)).wait();
    console.log("Ownership offered to", process.env.OWNER_ADDRESS, "- it must call acceptOwnership()");
  }
  console.log("Deploy block", receipt.blockNumber, "(set VITE_ESCROW_DEPLOY_BLOCK to this)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

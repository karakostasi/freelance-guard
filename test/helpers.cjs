const { ethers } = require("hardhat");

const REVIEW = 3 * 24 * 3600;
const DAY = 24 * 3600;

const item = (title, amount, days = 7) => ({ title, amount, duration: days * DAY });

/** The options of createJob: no verifier, no yield and not funded, unless overridden. */
const opts = (overrides = {}) => ({ verifier: ethers.ZeroAddress, useYield: false, fundNow: false, ...overrides });

/** Token rules for the escrow, with no fee, no limits and no vault unless overridden. */
const rules = (overrides = {}) => ({ enabled: true, surchargeBps: 0, minFee: 0n, minJob: 0n, vault: ethers.ZeroAddress, ...overrides });

/** Seeded random numbers (mulberry32), so a random test run is the same every time. `rnd(n)` is an integer below n. */
function rng(seed) {
  let state = seed;
  return (n) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/**
 * Deploys the escrow. By default it charges nothing (no fee, no surcharge, no minimums) and ETH plus the
 * given tokens are enabled, so the tests of the escrow mechanics see exact amounts. Pass `free: false` to
 * get the contract as deployed, with its default fee and nothing enabled.
 */
async function deploy({ free = true, tokens = [] } = {}) {
  const [owner, payer, payee, arbiter, other, treasury] = await ethers.getSigners();
  const escrow = await ethers.deployContract("FreelanceEscrow", [owner.address, arbiter.address, treasury.address, REVIEW]);
  if (free) {
    await escrow.setFeeBps(0);
    for (const token of [ethers.ZeroAddress, ...tokens]) await escrow.configureToken(token, rules());
  }
  return { escrow, owner, payer, payee, arbiter, other, treasury };
}

module.exports = { REVIEW, DAY, item, opts, rules, rng, deploy };

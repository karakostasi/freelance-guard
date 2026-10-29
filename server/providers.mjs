// Sandbox providers. Each one has the shape of its real counterpart, so swapping in a real
// bank, AML or off-ramp provider means replacing the body of one function.
// Every result is tagged source: "sandbox" so the UI can say so.

import { randomBytes } from "node:crypto";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => randomBytes(n).toString("hex");

export const EUR_PER_ETH = 2500;
/** Demo rate: what one US dollar stablecoin is worth in euros. The same as the frontend's. */
export const EUR_PER_USDC = 0.92;

/** Tokens the payment flow accepts besides ETH. Addresses are Base Sepolia test tokens; override with env. */
export const TOKENS = {
  eurc: {
    symbol: "EURC",
    decimals: 6,
    fiat: "EUR",
    address: process.env.EURC_ADDRESS || "0x808456652fdb597867f38412077A9182bf77359F",
  },
  usdc: {
    symbol: "USDC",
    decimals: 6,
    fiat: "USD",
    address: process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};

export const aml = {
  async screen({ payer, amountEur }) {
    await wait(700);
    return { source: "sandbox", provider: "mock-aml", payer, amountEur, sanctionsHit: false, riskScore: 0.04, result: "PASS" };
  },
};

export const fx = {
  async lock({ amountEur, token = "eth" }) {
    await wait(500);
    const lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
    if (token === "eth") return { source: "sandbox", pair: "EUR/ETH", eurPerEth: EUR_PER_ETH, amountEur, lockedUntil };
    if (token === "usdc") return { source: "sandbox", pair: "USD/USDC", rate: 1, amountEur, lockedUntil };
    return { source: "sandbox", pair: "EUR/EURC", rate: 1, amountEur, lockedUntil };
  },
};

export const reserves = {
  async check() {
    await wait(700);
    return { source: "sandbox", provider: "mock-attestation", reservesEur: "12480331.20", issuedEur: "12480331.20", ratio: "1.000" };
  },
};

/** The sandbox's record of the conversion. The tokens themselves are created by minter.mjs, when it is set up. */
export const mint = {
  async mint({ amountEur, token = "eth" }) {
    await wait(700);
    return {
      source: "sandbox",
      note:
        token === "eth"
          ? "No token is minted: the escrow holds ETH, so this step only records the conversion."
          : "A real on-ramp would deliver the stablecoin to the payer's wallet. The sandbox creates a test token there instead, when it can.",
      amountEur,
      reference: `mint_${hex(6)}`,
    };
  },
};

export const offramp = {
  async send({ route, amountEur, amount, currency, last4 }) {
    await wait(900);
    if (route === "eurc") return { source: "sandbox", rail: "base", amountEur, reference: `eurc_${hex(6)}` };
    const account = last4 ? { account: `…${last4}` } : {};
    if (route === "ach") return { source: "sandbox", rail: "ach", amount, currency, amountEur, ...account, reference: `ACH-${hex(5)}` };
    return { source: "sandbox", rail: "sepa_instant", amount, currency, amountEur, ...account, reference: `SQ-${hex(5)}` };
  },
};

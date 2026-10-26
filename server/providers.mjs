// Sandbox providers. Each one has the shape of its real counterpart, so swapping in a real
// bank, AML or off-ramp provider means replacing the body of one function.
// Every result is tagged source: "sandbox" so the UI can say so.

import { randomBytes } from "node:crypto";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => randomBytes(n).toString("hex");

export const EUR_PER_ETH = 2500;

/** Tokens the payment flow accepts besides ETH. Addresses are Base Sepolia test tokens; override with env. */
export const TOKENS = {
  eurc: {
    symbol: "EURC",
    decimals: 6,
    address: process.env.EURC_ADDRESS || "0x808456652fdb597867f38412077A9182bf77359F",
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
    return token === "eth"
      ? { source: "sandbox", pair: "EUR/ETH", eurPerEth: EUR_PER_ETH, amountEur, lockedUntil }
      : { source: "sandbox", pair: "EUR/EURC", rate: 1, amountEur, lockedUntil };
  },
};

export const reserves = {
  async check() {
    await wait(700);
    return { source: "sandbox", provider: "mock-attestation", reservesEur: "12480331.20", issuedEur: "12480331.20", ratio: "1.000" };
  },
};

export const mint = {
  async mint({ amountEur, token = "eth" }) {
    await wait(700);
    return {
      source: "sandbox",
      note:
        token === "eth"
          ? "No token is minted: the escrow holds ETH, so this step only records the conversion."
          : "No new EURC is minted. The escrow pulls EURC the payer already holds in their wallet.",
      amountEur,
      reference: `mint_${hex(6)}`,
    };
  },
};

export const offramp = {
  async send({ route, amountEur }) {
    await wait(900);
    return route === "eurc"
      ? { source: "sandbox", rail: "base", amountEur, reference: `eurc_${hex(6)}` }
      : { source: "sandbox", rail: "sepa_instant", amountEur, reference: `SQ-${hex(5)}` };
  },
};

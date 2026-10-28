/** The escrow's fee rules, as the contract applies them. All amounts are in the token's base units, and rounding is down. */

const BPS = 10_000n;

/** The payee's share of the job fee for one milestone, taken from its payment. */
export const milestoneFeeShare = (jobFee: bigint, amount: bigint, jobTotal: bigint) => (jobTotal === 0n ? 0n : (jobFee * amount) / jobTotal);

/** What the payer pays on top of a milestone when funding it. */
export const surchargeOn = (amount: bigint, surchargeBps: number) => (amount * BigInt(surchargeBps)) / BPS;

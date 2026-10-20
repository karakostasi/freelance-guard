# freelance-guard

Peer-to-peer freelance marketplace on Ethereum. A client's payment is locked in an escrow smart contract, so freelancers can't be stiffed and clients only pay for delivered work.

## How it works

1. Client creates a job and funds the escrow (ETH) with a delivery deadline.
2. Freelancer submits the deliverable (link/IPFS hash).
3. Client approves and the freelancer is paid. If the client stays silent past the review period (3 days), the freelancer claims the funds.
4. Client can dispute within the review period; an arbiter decides who gets the funds.
5. If nothing is delivered by the deadline, the client reclaims the funds.

## Layout

- `contracts/` Solidity (`FreelanceEscrow.sol`)
- `test/`, `scripts/` Hardhat tests and deploy script
- `src/` React + TypeScript + wagmi/viem frontend

## Run locally

```sh
npm install
npm test

npm run node            # terminal 1: local chain
npm run deploy:local    # terminal 2: prints the contract address
cp .env.example .env    # set VITE_ESCROW_ADDRESS to that address
npm run dev             # terminal 2: frontend
```

Connect MetaMask to `http://127.0.0.1:8545` (chain id 31337).

## Payment flow backend (optional)

`npm run server` starts a small Node backend (default `http://localhost:8787`) that runs the fiat-to-escrow pipeline for real and streams every step to the Payment flow page:

- receives the bank webhook (HMAC-signed, signature verified) and records ledger entries,
- prepares the exact `createJob` call for the user's wallet and watches the escrow contract for events,
- runs the payout routing automatically once the escrow releases the funds,
- keeps all state in `server/data/db.json` and resumes from the last processed block after a restart.

The bank, AML, FX and off-ramp providers are **sandboxes** (`server/providers.mjs`), each shaped like its real counterpart. Without the backend the page falls back to a local demo.

Set `VITE_PAYMASTER_URL` to try sponsored gas. It only applies if the wallet supports sponsored calls (EIP-5792 + ERC-7677) and otherwise the wallet pays as usual.

## Known limitations

- ETH only, no stablecoins yet.
- Dispute resolution is a single arbiter address, all-or-nothing (no split).
- No marketplace listings/profiles yet, jobs are created directly with a freelancer's address.

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

## Milestones and tokens

A job has 1 to 20 milestones, each with a title, an amount and the number of days the freelancer has to deliver. Every milestone is funded, delivered, approved and paid (or refunded) on its own, so a dispute on one milestone doesn't block the others.

- `createJob(freelancer, token, description, milestones, fundNow)` creates the job. With `fundNow` every milestone is funded in the same transaction (send the total as ETH, or approve the total for a token). Without it, the client funds milestones one at a time with `fundMilestone(id, index)`.
- The freelancer's deadline for a milestone starts when that milestone is funded, not when the job is created.
- `token` is `address(0)` for ETH, or an ERC-20 address. A job uses one token. The client approves the escrow first, and payouts and refunds are in the same token. Fee-on-transfer tokens are rejected.
- All actions take the job id and the milestone index: `submitWork`, `approve`, `claimAfterTimeout`, `dispute`, `resolve`, `refundExpired`.

One form hires a freelancer, on the Jobs page and in the "Fund a job" drawer of the Payment flow page. It has a split builder (1 payment, 50 / 50, 30 / 40 / 30, or custom shares) and a choice of how to pay:
- **From my wallet:** an on-chain transaction, with ETH, EURC or USDC, funding everything now or milestone by milestone.
- **Bank transfer in euros:** the backend runs the live payment flow (sandbox bank steps, then a real deposit signed in the wallet). It pays everything at once, with ETH or EURC, and the live steps follow the first milestone. Other milestones show the real on-chain data.

On Base Sepolia the app uses Circle's test EURC and USDC. Get free test tokens at faucet.circle.com. Verify the addresses against Circle's docs, or override them with `VITE_EURC_ADDRESS`, `VITE_USDC_ADDRESS` and `EURC_ADDRESS`. On a local chain, `npm run deploy:local` also deploys a mock EURC and prints its address.

**Upgrading an existing deployment:** the contract changed (milestones, a new `createJob` signature and new events), so it needs a new deployment. Order matters:
1. `npm run deploy:base-sepolia`, then note the new address and deploy block.
2. Set the new address in Vercel (`VITE_ESCROW_ADDRESS`, `VITE_ESCROW_DEPLOY_BLOCK`), Render (`ESCROW_ADDRESS`) and your local `.env`.
3. Merge and redeploy. Jobs on the old contract no longer show, and the backend ignores their payment runs.

## Payment flow backend (optional)

`npm run server` starts a small Node backend (default `http://localhost:8787`) that runs the fiat-to-escrow pipeline for real and streams every step to the Payment flow page:

- receives the bank webhook (HMAC-signed, signature verified) and records ledger entries,
- prepares the exact `createJob` call for the user's wallet and watches the escrow contract for events,
- runs the payout routing automatically once the escrow releases the funds,
- keeps all state in `server/data/db.json` and resumes from the last processed block after a restart.

The bank, AML, FX and off-ramp providers are **sandboxes** (`server/providers.mjs`), each shaped like its real counterpart. Without the backend the page falls back to a local demo.

Set `VITE_PAYMASTER_URL` to try sponsored gas. It only applies if the wallet supports sponsored calls (EIP-5792 + ERC-7677) and otherwise the wallet pays as usual.

## Deploying (free tiers)

The contract ABI is committed in `abi/` (refreshed by `npm run compile`), so neither host needs Hardhat to build.

1. **Database (Supabase).** Create a project, then Project Settings, Database, Connection string, **Session pooler**. Copy the URI and put your password in. Use the pooler, not the direct connection: the direct one is IPv6-only and Render's free tier can't reach it. The backend creates its table on first start.
2. **Backend (Render).** New, Blueprint, pick this repo (it reads `render.yaml`). Set `ESCROW_ADDRESS`, `DATABASE_URL`, and later `CORS_ORIGIN`. The free tier sleeps after ~15 minutes idle, so point a free uptime pinger (e.g. UptimeRobot) at `/api/health` every 5 minutes.
3. **Frontend (Vercel).** Import the repo (framework: Vite). Set `VITE_ESCROW_ADDRESS`, `VITE_ESCROW_DEPLOY_BLOCK` and `VITE_API_URL` (the Render URL). Then put the Vercel URL into Render's `CORS_ORIGIN`.

Never upload your local `.env` (it holds the deployer key). Set variables in each dashboard instead.

## Job titles, specs and files

A job has a title, an optional spec and optional attachments. A milestone's deliverable can be a link, a note, or uploaded files.

- **On-chain** a job's `description` is `<title>` or `<title>\n<spec>`, where the spec is plain text or a pointer `fg:<sha256>`. A deliverable is plain text or such a pointer. Nothing about the contract changed, so older jobs read as before.
- **The pointer is to a small JSON document** (a note and a list of files with names, sizes and SHA-256 hashes) held by the backend. Because the hashes are recorded on-chain, anyone can check that a downloaded file is the one that was delivered (the **Verify** button does it).
- **Storage:** file bytes are kept in Postgres (`file_blobs`) when `DATABASE_URL` is set, otherwise in `server/data/files/`. Short specs (up to 280 characters) without files stay entirely on-chain.
- **Uploads need a wallet signature** (one sign-in message per hour), so the backend can't be used as free file hosting. Limits: 10 MB per file, 5 files per form, 50 uploads and 200 MB per address per day, and 300 MB in total (see `.env.example`). Files are served with `nosniff` and a sandbox policy, and only images, PDFs, text and JSON are shown in the browser. Everything else downloads.
- Files are **not private**: anyone with a file's hash can download it. Don't upload secrets.

## Sign in with a passkey, and free gas

People without a crypto wallet sign in with a **passkey** (fingerprint or face). That creates a Base Account (formerly Coinbase Smart Wallet) for them, with no seed phrase and no extension. MetaMask still works for people who have it. The sign-in chooser is in `src/components/ConnectButton.tsx`.

Network fees can be paid for the user by a **paymaster**. When `VITE_PAYMASTER_URL` is set and the wallet supports it, every action (create or fund a job, submit, approve, claim, refund...) goes out through `src/lib/tx.ts` as sponsored calls, and a token approval plus the action are sent in **one confirmation**. If sponsoring isn't available, the same code falls back to ordinary transactions, exactly as before.

Setup:
1. `npm install @base-org/account`, then commit `package.json` and `package-lock.json`. The app builds without it, but the passkey button needs it.
2. In the Coinbase Developer Platform, open Paymaster, pick **Base Sepolia**, enable it, and copy the endpoint into `VITE_PAYMASTER_URL` (locally and on Vercel).
3. In the paymaster policy, allow only what you want to pay for: your escrow contract (`createJob`, `fundMilestone`, `submitWork`, `approve`, `dispute`, `claimAfterTimeout`, `refundExpired`, `resolve`) and `approve` on the EURC and USDC contracts. Set a per-user and a global spend limit.

Smart-wallet signatures can't be checked off-chain, so the backend confirms them with the chain (`client.verifyMessage`) when a plain signature check fails. File uploads work the same for passkey users.

## Wallet card

On the Jobs and Payment flow pages a wallet card is always visible on the right: your ETH, EURC and USDC balances (with a euro estimate at the app's demo rates), **Send**, and **Receive** (your address and links to test-fund faucets). A send checks the address and amount first, shows a review with the full address, then your own wallet asks you to confirm, so the app never holds keys. There is deliberately no swap: the test tokens have no real market on Base Sepolia.

## Tests and CI

- `npm test` runs the contract tests (Hardhat).
- `npm run test:unit` checks the document format, balance formatting, send rules, sign-in sessions and file stores (no chain or network needed).
- `npm run test:flow` is an end-to-end check of the payment flow. It starts its own throwaway chain and backend on ports 8645 and 8799 (override with `TEST_CHAIN_PORT` and `TEST_API_PORT`), so it never touches your dev servers. It drives real ETH and EURC payments, including a 3-milestone split, plus the upload, sign-in, download and quota rules, through the API and the contract, and takes about half a minute.
- `npm run lint` and `npm run build` check the frontend.

GitHub Actions runs all of them on every pull request and on pushes to `main` (`.github/workflows/ci.yml`), and also checks that the committed ABI in `abi/` matches the contract. If that check fails, run `npm run compile` and commit the result.

CI installs with `npm ci`, so it uses exactly the versions in `package-lock.json`. After adding or changing a dependency, run `npm install` and commit the updated lockfile, or CI will refuse it.

## Known limitations

- Jobs can be paid in ETH or ERC-20 tokens (EURC and USDC are listed). Fee-on-transfer tokens are rejected, and each job is in a single token.
- Dispute resolution is a single arbiter address, all-or-nothing (no split).
- No marketplace listings/profiles yet, jobs are created directly with a freelancer's address.

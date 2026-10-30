# Squirrel

Milestone escrow for business payments on Ethereum. A payer's payment is locked in an escrow smart contract, so payees can't be stiffed and payers only pay for delivered work.

## How it works

1. Payer creates a job and funds the escrow (ETH) with a delivery deadline.
2. Payee submits the deliverable (link/IPFS hash).
3. Payer approves and the payee is paid. If the payer stays silent past the review period (3 days), the payee claims the funds.
4. Payer can dispute within the review period; an arbiter decides who gets the funds.
5. If nothing is delivered by the deadline, the payer reclaims the funds.

## Terminology

The two sides are the **payer** (funds the escrow) and the **payee** (delivers and gets paid). The contract uses the same names. A job can also name a **verifier**, an address that may approve delivered milestones for the payer.

## Pricing

The rules are in `docs/business-model.md` and the contract design in `docs/contract-v2-design.md`.

- The **payee** pays a fee out of each released milestone: the larger of a per-token minimum and 0.25% of the job, shared between the milestones by amount. There is no fee on a refund.
- The **payer** pays a 0.25% surcharge on top of each milestone when funding it, which is not refunded. A job that takes the **yield** (USDC only, test network only) pays no surcharge. While it is in escrow its money sits in an ERC-4626 vault, the platform keeps what the vault earns, and the amount is returned in full.
- The terms are fixed when the job is created, so later changes by the owner never touch an existing job. Only tokens the owner enabled can be used (`configureToken`). `quote(token, amounts, useYield)` prices a job with the same rules as `createJob`, and the frontend and backend call it.

## Themes

There are two, dark (the original look, and the default) and light. The sun and moon button in the header switches between them, and the choice is remembered in the browser. The colours are tokens in `src/index.css`: the dark values are in `:root` and the light ones in `:root[data-theme="light"]`, so a new colour belongs there and not in a component's CSS. `index.html` applies a saved light theme before the page paints. Receipts stay white paper in both.

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

Connect MetaMask to `http://127.0.0.1:8545` (chain id 31337), and set `VITE_LOCAL_CHAIN=1` so the app offers that chain.

## Milestones and tokens

A job has 1 to 20 milestones, each with a title, an amount and the number of days the payee has to deliver. Every milestone is funded, delivered, approved and paid (or refunded) on its own, so a dispute on one milestone doesn't block the others.

- `createJob(payee, token, description, milestones, { verifier, useYield, fundNow })` creates the job. With `fundNow` every milestone is funded in the same transaction (send the total plus the surcharge as ETH, or approve it for a token). Without it, the payer funds milestones one at a time with `fundMilestone(id, index)`, sending the milestone plus its surcharge.
- The payee's deadline for a milestone starts when that milestone is funded, not when the job is created.
- `token` is `address(0)` for ETH, or an ERC-20 address. A job uses one token. The payer approves the escrow first, and payouts and refunds are in the same token. Fee-on-transfer tokens are rejected.
- All actions take the job id and the milestone index: `submitWork`, `approve` (the payer or the verifier), `claimAfterTimeout`, `dispute`, `resolve`, `refundExpired`. The payer can change or remove the verifier at any time with `setVerifier(id, address)`. Once a verifier approves a milestone the payer can no longer dispute it.

"Create a job" is a page of its own, in three steps: who you pay, for what and how much; the payment stages (1 payment, 50 / 50, 30 / 40 / 30, or custom shares); and a review that shows the one number you pay. A button that is off always says why under it. The currency next to the amount says how you pay:
- **ETH, EURC or USDC:** from your wallet, an on-chain transaction, funding everything now or milestone by milestone.
- **EUR or USD:** by card or bank transfer. The backend runs the live payment flow (sandbox bank steps, then a real deposit signed in the wallet). Euros become EURC and dollars become USDC, in the payer's own wallet, and USDC can take the yield. It pays everything at once, and the live steps follow the first milestone. Other milestones show the real on-chain data. Without the backend these two are greyed out.

The options most people leave alone sit under "More options" on the second step: when to fund, a verifier, the description and files, and the business details.

On the Jobs page a job opens with what it is worth to you (the payer sees what they pay, the payee what they earn after the fee), the one thing to do next with its main button, and its stages. Reporting a problem, the transactions and the details are one click away. The Payment flow page shows the same next step on top, and below it the journey as a row of boxes, with a Simple and a Detailed view.

On Base Sepolia the app uses Circle's test EURC and USDC. Get free test tokens at faucet.circle.com. Verify the addresses against Circle's docs, or override them with `VITE_EURC_ADDRESS`, `VITE_USDC_ADDRESS` and `EURC_ADDRESS`. On a local chain, `npm run deploy:local` also deploys a mock EURC, a mock USDC and a mock vault for it, and prints their addresses. Circle's test USDC can't be minted, so to try the yield on a test network deploy with `MOCK_USDC=1` (a mock USDC and its vault) or set `USDC_VAULT_ADDRESS` to a vault of your own. The vault's `accrueYield(amount)` and `setRatePerYear(bps)` make it earn.

**Upgrading an existing deployment:** the contract changed (fees, a token whitelist, a new `createJob` signature and new events), so it needs a new deployment. Order matters:
1. `npm run deploy:base-sepolia`, then note the new address and deploy block.
2. The deployer is the owner and sets up ETH, USDC and EURC (the smallest fee and job come from `MIN_FEE_EUR` and `MIN_JOB_EUR`, the launch values are 40 and 2000). Set `ARBITER_ADDRESS`, `TREASURY_ADDRESS` and `OWNER_ADDRESS` to addresses you control before a real deployment.
3. Set the new address in Vercel (`VITE_ESCROW_ADDRESS`, `VITE_ESCROW_DEPLOY_BLOCK`), Render (`ESCROW_ADDRESS`) and your local `.env`.
4. Merge and redeploy. Jobs on the old contract no longer show, and the backend ignores their payment runs.

## Paying in euros or dollars

The payer pays in euros or US dollars and gets the matching stablecoin (EURC or USDC) in their own wallet, then deposits it into escrow with the same wallet. The bank, AML and FX steps are sandboxes, and the conversion works like this:

- **Test networks (what runs today).** The sandbox stands in for an on-ramp that delivers the token: the backend mints the payer a test token of the exact amount (the job plus the surcharge) before asking them to sign. That only works with the mock tokens, which anyone can mint, so deploy with `MOCK_USDC=1` (and a mock EURC) and set `MINT_PRIVATE_KEY` for the backend. Circle's test tokens can't be minted, so with those the payer has to hold the token already, and the step says so. The key is only used on Hardhat, Base Sepolia and Sepolia (`server/minter.mjs`), never set it on a real network.
- **How the payee is paid.** The payee decides, not the payer: a bank account in euros (SEPA), a US bank account in dollars (ACH), or the stablecoin kept in their wallet. They choose it from the next-step card of a job or from "How I get paid" in the account menu, and can change it until the payment is released, which is when the backend reads it (`server/payout.mjs`). If they haven't chosen by then, nothing is sent anywhere: the escrow has already paid the stablecoin into their wallet, the card says so and asks them to choose, and the payout goes ahead the moment they do. Anyone can see how an address is paid and the last four digits of the account, only the payee can read the account. IBANs and US routing numbers are checked, and in the sandbox no money moves.
- **Real money.** The conversion moves to a licensed on-ramp (a widget the payer pays in, which sends the stablecoin to their wallet). The place to change is the `mint` step of the pipeline in `server/pipeline.mjs` and `server/providers.mjs`. Nothing there runs against a real provider yet. The sandboxes of the providers I checked (Transak, MoonPay) don't deliver USDC or EURC on Base Sepolia, only their own test tokens.

## Payment flow backend (optional)

`npm run server` starts a small Node backend (default `http://localhost:8787`) that runs the fiat-to-escrow pipeline for real and streams every step to the Payment flow page:

- receives the bank webhook (HMAC-signed, signature verified) and records ledger entries,
- prepares the exact `createJob` call for the user's wallet and watches the escrow contract for events,
- runs the payout routing automatically once the escrow releases the funds,
- keeps all state in `server/data/db.json` and resumes from the last processed block after a restart.

The bank, AML, FX and off-ramp providers are **sandboxes** (`server/providers.mjs`), each shaped like its real counterpart. Without the backend the page falls back to a local demo.

### Signing in without a wallet (Coinbase embedded wallet)

People can sign in with an **email**: we send a code, and a wallet is made for them (a smart account on Base Sepolia, from the [CDP Embedded Wallets](https://docs.cdp.coinbase.com/embedded-wallets)). There is nothing to install and no seed phrase. Every sign-in button opens the same dialog, which also has "Use MetaMask or another wallet" for people who already have one.

- **Set up:** create a project in the [CDP Portal](https://portal.cdp.coinbase.com), copy its Project ID into `VITE_CDP_PROJECT_ID`, and add `http://localhost:5173` and your Vercel URL to the allowed origins of its Embedded Wallets settings. Without the id the app only offers MetaMask.
- **Sending:** the smart account sends the token approval and the deposit as one batch (`wallet_sendCalls`, one confirmation). Every action in the app goes through `src/lib/tx.ts`, which does that for the embedded wallet and signs one by one for other wallets.
- **Gas:** on Base Sepolia the embedded wallet's gas is sponsored by default, so a new account needs no ETH. On mainnet, set up a paymaster in the CDP Portal. Its URL stays with Coinbase and never reaches the browser.
- **Signing in to the backend:** a smart account has no key to recover, so the backend asks its contract whether the signature is valid (ERC-1271, or ERC-6492 before the wallet exists on-chain).
- **Whose keys:** the wallet's keys are held by Coinbase's embedded wallet service, not by the person or by Squirrel. That matters for licensing (`docs/business-model.md`, decision 13).
- **Why not Base Account (passkey):** it would keep the keys with the person, but new Base Accounts can't send transactions on Base Sepolia ([base/account-sdk #363](https://github.com/base/account-sdk/issues/363)).
- **Not tested with the real service:** the code is checked against the connector's types and a stand-in wallet. The real email code, the smart account and the sponsored gas need a CDP project, and have to be tried by hand.

## Real money (Base mainnet)

The app is for play money (Base Sepolia) until it is built for the real network. `VITE_CHAIN=base` makes a build for Base mainnet, and everything that depends on the network comes from that one setting. On a real network the backend refuses to start with an unsafe setting and keeps the sandbox bank and the mint shut, and `npm run deploy:mainnet` puts the escrow there with an owner and an arbiter that are multisigs, from a key that holds no role, after a dry run that reads the chain. **Read `docs/mainnet.md`: it says what has to exist first (an audit, a legal opinion, real providers), what each step checks, and what isn't done.** The settings are in `.env.mainnet.example`.

## Receipts and business details

When creating a job, the payer can add **business details**: a PO or invoice reference, and a company name and VAT ID for each side. They are stored inside the job's document, whose SHA-256 is already in the job's on-chain description, so they can't be changed afterwards without the hash showing it. No contract change was needed. Jobs without them work as before. They need the backend, and are not verified by Squirrel.

Every paid milestone has a **receipt** at `#/receipt/<job>/<milestone>` (milestones numbered from 1). It is built from the chain and the job's document, so anyone with the link sees the same thing, with no wallet connected. It shows the amount, date, parties, reference, how the payment was released, and links to the transaction and contract. **Print or save as PDF** uses the browser's print dialog. A receipt is a record of payment, not a tax invoice. The "payment released" emails link to it, and so do the milestone views on the Jobs and Payment flow pages.

The details document is public to anyone who looks the job up on-chain, like the job's other documents, so don't put anything in it you wouldn't want public. The date comes from searching the chain for the release transaction, which can take a while on old jobs with a public RPC.

## Email notifications (optional)

With the backend running, people can open **Email notifications** in the account menu, sign in with their wallet and give an email address. After they confirm it with the link we send, both the payer and the payee get an email at every step of a job, worded for their side:
- a milestone is funded,
- work is submitted (the payer is told how long they have to review it),
- the payment is released (approved, claimed after the timeout, or decided by the arbiter),
- the work is disputed (the arbiter is told too, if they registered an email),
- the payment is refunded.

This works for every job on the escrow, whichever way it was created. A transaction that funds several milestones sends one email to each person. Every email has an unsubscribe link, and nothing is sent to an address that hasn't been confirmed.

Set `RESEND_API_KEY` (and `MAIL_FROM`, `APP_URL`, `PUBLIC_API_URL`, see `.env.example`) to send real emails through [Resend](https://resend.com). Without a key, the emails are only logged by the backend. Resend's default sender only delivers to your own account's address, so verify a domain there to email everyone. `NOTIFY_WEBHOOK_URL` still receives the events of payment runs as before.

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

## Wallet card

On the Jobs and Payment flow pages a wallet card is always visible on the right: your ETH, EURC and USDC balances (with a euro estimate at the app's demo rates), **Send**, and **Receive** (your address and links to test-fund faucets). A send checks the address and amount first, shows a review with the full address, then your own wallet asks you to confirm, so the app never holds keys. There is deliberately no swap: the test tokens have no real market on Base Sepolia.

## Tests and CI

- `npm test` runs the contract tests (Hardhat).
- `npm run test:unit` checks the document format, balance formatting, send rules, sign-in sessions and file stores (no chain or network needed).
- `npm run test:flow` is an end-to-end check of the payment flow. It starts its own throwaway chain and backend on ports 8645 and 8799 (override with `TEST_CHAIN_PORT` and `TEST_API_PORT`), so it never touches your dev servers. It drives real ETH and EURC payments, including a 3-milestone split and the surcharge and fee, a wallet job that takes the yield with a verifier, plus the upload, sign-in, download and quota rules, through the API and the contract, and takes about half a minute.
- `npm run lint` and `npm run build` check the frontend.

GitHub Actions runs all of them on every pull request and on pushes to `main` (`.github/workflows/ci.yml`), and also checks that the committed ABI in `abi/` matches the contract. If that check fails, run `npm run compile` and commit the result.

CI installs with `npm ci`, so it uses exactly the versions in `package-lock.json`. After adding or changing a dependency, run `npm install` and commit the updated lockfile, or CI will refuse it.

## Known limitations

- Jobs can be paid in ETH or ERC-20 tokens the owner enabled (EURC and USDC are listed). Fee-on-transfer tokens are rejected, and each job is in a single token.
- The yield works with a mock vault only, on test networks. There is no adapter for a real lending market, and who covers a loss in a vault is not decided (`docs/contract-v2-design.md`).
- Dispute resolution is a single arbiter address, all-or-nothing (no split).
- No marketplace listings/profiles yet, jobs are created directly with the payee's address.

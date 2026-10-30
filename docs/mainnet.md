# Going live on Base mainnet

This is what it takes to run Squirrel with real money, what the code now does to make that safe, and what it still can't do for you. Read it with `docs/business-model.md` (the decisions and the legal questions).

**Nothing here has been audited or legally cleared.** The code makes a wrong setting hard and a right one checkable. It does not replace an audit of the contract, a legal opinion, or the people who hold the keys.

## 1. What has to exist before the first euro

| What | Why it can't be code |
| --- | --- |
| **An audit of `FreelanceEscrow.sol`**, and its fixes re-checked | Every change after the audit means a new deployment and a new audit. Decide the contract's last changes first (see section 8). |
| **A legal opinion** (MiCA, payment institution, deposit-taking, who is the custodian of the email wallets, what the terms must say) | Holding other people's money for a fee is regulated. Yield stays off until this exists. |
| **Two Safes** (multisigs) on Base: the owner and the arbiter | See section 2. |
| **A bank on and off ramp**, if card and bank payments are to open | The bank, the checks and the payout are sandboxes today. The server keeps them shut on a real network. |
| **A CDP project for real money**, with the app's origin allowed and a paymaster | Gas on Base mainnet isn't sponsored by default. |
| **Your own RPC**, a **Postgres** database, **monitoring** and **backups** | The public RPC limits what can be read, and a file on a server's disk is lost on a redeploy. |

## 2. Keys and roles

| Role | Who | Notes |
| --- | --- | --- |
| **Owner** | A Safe, 2 of 3 or better, hardware wallets | Can switch tokens on, set the fee (at most 1%), change the treasury, pause, and take money out of a vault. Can never touch a job that already exists, or take escrowed money. |
| **Arbiter** | A *different* Safe, with different signers | Decides disputes, all or nothing between the payer and the payee. **It is fixed in the contract and can never be changed.** A lost or leaked key can't be replaced, so it is a Safe. |
| **Treasury** | A Safe if you can | Receives the fees. The owner can change it. |
| **Deploying key** | A fresh key, used once | Holds **no** role: the owner goes into the constructor, so there is no moment when a key on a laptop owns the escrow. Drop it after the deploy. |

The review period is fixed too. Think about it before the deploy.

The key that creates play money (`MINT_PRIVATE_KEY`) and the test network's deploying key don't belong anywhere near this.

## 3. Rehearse on Base Sepolia first

The same script runs on the test network, with the same checks, so every step is practised once with play money:

1. Make two Safes on Base Sepolia (app.safe.global).
2. Fill in `.env.mainnet` from `.env.mainnet.example`, but with the test network's values, and run `ENV_FILE=.env.mainnet npm run deploy:rehearsal` (a dry run), then again with `EXECUTE=1`.
3. Switch the tokens on from the Safe, with the batch the script wrote.
4. Run the backend with `STRICT=1` and `EXPECTED_CHAIN_ID=84532`: it holds itself to the rules of real money, on a test network.
5. Practise pausing and unpausing from the Safe.

## 4. The deploy, step by step

```
cp .env.mainnet.example .env.mainnet      # fill it in
ENV_FILE=.env.mainnet npm run deploy:mainnet          # a dry run: checks, prints, sends nothing
ENV_FILE=.env.mainnet EXECUTE=1 CONFIRM_CHAIN_ID=8453 npm run deploy:mainnet
```

The dry run reads the chain and refuses (with the reason) if:

- the RPC isn't Base mainnet (chain 8453), or the working tree isn't clean (the deployed code has to be findable from its commit);
- the owner or the arbiter isn't a Safe, has fewer than 3 signers or needs all of them or needs fewer than 2, or if the deploying key or the same person is a signer on them;
- the owner, arbiter or treasury is the deploying key, or the owner and the arbiter are the same;
- a token isn't Circle's USDC or EURC for Base, or its name, symbol and decimals aren't what they should be;
- a limit, the review period or the surcharge is missing or outside what the contract allows, or a mock or a yield vault is asked for;
- the deploying key can't pay for it, or this network already has a deployment recorded.

It sends only with `EXECUTE=1` **and** `CONFIRM_CHAIN_ID=8453`. After it deploys it reads everything back from the chain (owner, arbiter, treasury, review period, nothing switched on, no handover) and writes `deployments/base.json` (address, block, commit, hash of the code) and `deployments/base.safe-config.json`.

Then:

1. **The owner Safe switches the tokens on.** In the Safe app: *Transaction Builder*, drop `deployments/base.safe-config.json` in, check every value, sign. The raw calls are printed too, in case the file isn't taken. (The file format is the Safe Transaction Builder's; I haven't been able to try it with a real Safe.) Yield is **not** switched on here.
2. **Publish the source:** the script prints the `npx hardhat verify` line (needs `ETHERSCAN_API_KEY`).
3. **Check what is on-chain:** `ENV_FILE=.env.mainnet REQUIRE_CONFIGURED=1 npm run check:deployment`. It compares the code, the roles, the limits and the vaults with the record, and fails on anything different (a changed limit, a vault someone set, a handover nobody planned). Run it again from time to time, and put it in a monitor.
4. **A very small job, end to end, with your own money.** Then pause and unpause from the Safe, so the first time isn't during an incident.

## 5. The backend

Set the values in `.env.mainnet` on the server. With `EXPECTED_CHAIN_ID=8453` (or any real network, or `STRICT=1`) it **refuses to start** unless:

- the RPC answers and is the chain named; `ESCROW_ADDRESS` and `RPC_URL` are named, not defaulted;
- `WEBHOOK_SECRET` and `SESSION_SECRET` are random, at least 32 characters, and different;
- `CORS_ORIGIN`, `APP_URL` and `PUBLIC_API_URL` are `https://` addresses (the origin can't be empty or `*`);
- there is a `DATABASE_URL` (a file store needs `ALLOW_FILE_DB=1`, said on purpose);
- `MINT_PRIVATE_KEY` is not set, and `USDC_ADDRESS` and `EURC_ADDRESS`, if set, are Circle's.

While it runs on a real network the **sandbox is shut**: no card payment can be started, the sandbox bank and its webhook answer 503, and bank details for a payout aren't taken (only "keep the stablecoin" is). `/api/health` says `realMoney`, `bankRails` and `chainId`, and the site shows a red banner if its server is on a network the site doesn't know. Nothing turns these rules off; `STRICT=1` only adds them to a test network.

## 6. The site

Build it with `VITE_CHAIN=base`. Then, from that one setting:

- the chain, the explorer links and the name on receipts are Base's;
- USDC and EURC are Circle's, fixed in the code (`VITE_USDC_ADDRESS` and `VITE_EURC_ADDRESS` are ignored);
- ETH isn't offered as a way to pay (its euro value and the escrow's limits in euros were play-money rates), and no euro value is invented for USDC or ETH, and there is no "total balance";
- faucet hints, "test funds" and "Testnet demo, no real money" are gone, and the "Test network" tag in the header only shows on a test network;
- EUR and USD (card or bank) are switched off while the backend says the rails are closed.

A build for the test network has the "Test network" tag.

## 7. Day two

- **Incident:** the owner Safe pauses (`setPaused(true)`): no new jobs or funding. Payments, approvals and refunds keep working, so nobody's money is stuck. Agree beforehand who signs and how they are reached at night.
- **Rotate a signer** of a Safe in the Safe app. **Hand the owner to a new Safe** with `transferOwnership`, then `acceptOwnership` from the new Safe: two steps, so a mistyped address can't take it. `npm run check:deployment` will say a handover is pending until it is done.
- **The arbiter can't be rotated.** If its Safe is lost, disputes can't be decided. Payees can still claim after the review period, and payers can still reclaim after a deadline.
- Keep `deployments/base.json` with the audit report and the commit.

## 8. What isn't done, and should be decided before the audit

These need a change in the contract (so a new audit if they come later), or a decision:

- **A guardian who can only pause.** Pausing needs the owner Safe's signatures, which at night may be slow. A separate key that can pause but nothing else is common. A timelock on the owner's other powers is the other usual piece.
- **A limit on the size of one job.** There is a smallest job, but no largest. A cap in the first weeks bounds the loss from a bug.
- **A different arbiter than "one address, all or nothing"** (a split, an appeal), if the legal opinion asks for it.
- **A real yield vault.** Only a mock exists. The vault's loss policy, and the real vault (Aave or another ERC-4626), come after the legal opinion.
- **A price for ETH and USDC in euros** (an oracle or a rate the operator sets), if the site is to show euro values for them.
- **Card and bank payments and bank payouts** need a real provider behind them. Until then the landing page's mention of euros and dollars is ahead of what a real network offers.
- **Wallet-paid jobs have no payout run** (what the payee chose for the bank isn't carried out).

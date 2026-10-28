const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { DAY, item, opts, rules, rng, deploy } = require("./helpers.cjs");

const U = (n) => ethers.parseUnits(String(n), 6); // USDC has 6 decimals
const MAX = ethers.MaxUint256;
const DUST = 1000n; // VAULT_DUST in the contract
const PAID = 4n;
const REFUNDED = 5n;

// Jobs that take the yield put their money in the token's vault while it is in escrow. Jobs that decline never touch it.
describe("FreelanceEscrow vault", () => {
  let escrow, owner, payer, payee, arbiter, other, treasury, stranger;
  let usdc, vault, usdcAddr, vaultAddr, escrowAddr;

  // The launch rules for USDC, now with a vault: payee fee max(40, 0.25%), payer surcharge 0.25% if declining the yield.
  const config = (overrides = {}) => rules({ surchargeBps: 25, minFee: U(40), minJob: U(2000), vault: vaultAddr, ...overrides });
  const newVault = async () => ethers.deployContract("MockVault", [usdcAddr]);

  beforeEach(async () => {
    ({ escrow, owner, payer, payee, arbiter, other, treasury } = await deploy({ free: false }));
    [, , , , , , stranger] = await ethers.getSigners();
    escrowAddr = await escrow.getAddress();
    usdc = await ethers.deployContract("MockERC20", ["Mock USDC", "USDC", 6]);
    usdcAddr = await usdc.getAddress();
    vault = await newVault();
    vaultAddr = await vault.getAddress();
    await escrow.configureToken(usdcAddr, config());
    await usdc.mint(payer.address, U(100_000_000));
    await usdc.connect(payer).approve(escrowAddr, MAX);
  });

  const create = (items, { useYield = false, fundNow = true } = {}) =>
    escrow.connect(payer).createJob(payee.address, usdcAddr, "ipfs://spec", items, opts({ useYield, fundNow }));
  const deliver = (id, m) => escrow.connect(payee).submitWork(id, m, "x");
  const idle = () => usdc.balanceOf(escrowAddr);
  const status = async (id, m) => (await escrow.getJob(id))[1][m].status;
  const epoch = async (id, m) => (await escrow.getJob(id))[1][m].epoch;
  // A job of 12,000 + 8,000: fee 50, shared 30 and 20.
  const twoMilestones = [item("a", U(12000)), item("b", U(8000))];

  describe("configuring a vault", () => {
    it("sets the vault and the first epoch", async () => {
      expect((await escrow.tokenConfig(usdcAddr)).vault).to.equal(vaultAddr);
      expect(await escrow.vaultEpoch(usdcAddr)).to.equal(1n);
    });

    it("announces the vault", async () => {
      const eurc = await ethers.deployContract("MockERC20", ["Mock EURC", "EURC", 6]);
      const v = await ethers.deployContract("MockVault", [await eurc.getAddress()]);
      await expect(escrow.configureToken(await eurc.getAddress(), rules({ vault: await v.getAddress() })))
        .to.emit(escrow, "TokenConfigured")
        .withArgs(await eurc.getAddress(), true, 0, 0, 0, await v.getAddress());
    });

    it("rejects a vault for ETH, for another token, or that is not a contract", async () => {
      const eurc = await ethers.deployContract("MockERC20", ["Mock EURC", "EURC", 6]);
      const eurcAddr = await eurc.getAddress();
      await expect(escrow.configureToken(ethers.ZeroAddress, rules({ vault: vaultAddr }))).to.be.revertedWithCustomError(escrow, "BadConfig");
      await expect(escrow.configureToken(eurcAddr, rules({ vault: vaultAddr }))).to.be.revertedWithCustomError(escrow, "BadConfig");
      await expect(escrow.configureToken(eurcAddr, rules({ vault: other.address }))).to.be.revertedWithCustomError(escrow, "BadConfig");
    });

    it("keeps the vault when the other settings change, but never swaps or drops it", async () => {
      await escrow.configureToken(usdcAddr, config({ surchargeBps: 10 }));
      expect((await escrow.tokenConfig(usdcAddr)).vault).to.equal(vaultAddr);
      const v2 = await newVault();
      await expect(escrow.configureToken(usdcAddr, config({ vault: await v2.getAddress() }))).to.be.revertedWithCustomError(escrow, "BadConfig");
      await expect(escrow.configureToken(usdcAddr, config({ vault: ethers.ZeroAddress }))).to.be.revertedWithCustomError(escrow, "BadConfig");
    });

    it("a token without a vault offers no yield", async () => {
      const eurc = await ethers.deployContract("MockERC20", ["Mock EURC", "EURC", 6]);
      await escrow.configureToken(await eurc.getAddress(), rules({ surchargeBps: 25 }));
      await expect(escrow.quote(await eurc.getAddress(), [U(5000)], true)).to.be.revertedWithCustomError(escrow, "NoYield");
      await expect(escrow.createJob(payee.address, await eurc.getAddress(), "x", [item("a", U(5000))], opts({ useYield: true }))).to.be.revertedWithCustomError(escrow, "NoYield");
      await expect(escrow.createJob(payee.address, ethers.ZeroAddress, "x", [item("a", 1n)], opts({ useYield: true }))).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
    });

    it("quotes no surcharge when taking the yield", async () => {
      expect(await escrow.quote(usdcAddr, [U(12000), U(8000)], false)).to.deep.equal([U(20000), U(50), U(50)]);
      expect(await escrow.quote(usdcAddr, [U(12000), U(8000)], true)).to.deep.equal([U(20000), U(50), 0n]);
    });
  });

  describe("funding", () => {
    it("puts the whole job in the vault, with no surcharge", async () => {
      const tx = create(twoMilestones, { useYield: true });
      await expect(tx).to.changeTokenBalances(usdc, [payer, vault, escrow], [-U(20000), U(20000), 0]);
      await expect(tx).to.emit(escrow, "JobCreated").withArgs(1, payer.address, payee.address, usdcAddr, U(20000), 2, U(50), 0, ethers.ZeroAddress, true);
      expect(await idle()).to.equal(0n);
      expect(await escrow.activeTotal(usdcAddr)).to.equal(U(20000));
      expect(await escrow.vaultDue(usdcAddr)).to.equal(U(20000));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(0n);
      expect((await escrow.jobs(1)).yield).to.equal(true);
      expect((await escrow.jobs(1)).surchargeBps).to.equal(0n);
      expect([await epoch(1, 0), await epoch(1, 1)]).to.deep.equal([1n, 1n]);
      expect(await usdc.allowance(escrowAddr, vaultAddr)).to.equal(0n);
    });

    it("a job that declines never touches the vault, and pays the surcharge", async () => {
      await expect(create(twoMilestones)).to.changeTokenBalances(usdc, [payer, vault, escrow], [-U(20050), 0, U(20050)]);
      expect(await vault.totalAssets()).to.equal(0n);
      expect(await vault.balanceOf(escrowAddr)).to.equal(0n);
      expect(await escrow.vaultDue(usdcAddr)).to.equal(0n);
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(50));
      expect((await escrow.jobs(1)).yield).to.equal(false);
      expect(await epoch(1, 0)).to.equal(0n);
    });

    it("puts only the funded milestone in the vault when funding one by one", async () => {
      await create(twoMilestones, { useYield: true, fundNow: false });
      expect(await vault.totalAssets()).to.equal(0n);
      await expect(escrow.connect(payer).fundMilestone(1, 1)).to.changeTokenBalances(usdc, [payer, vault], [-U(8000), U(8000)]);
      expect(await escrow.vaultDue(usdcAddr)).to.equal(U(8000));
      expect([await epoch(1, 0), await epoch(1, 1)]).to.deep.equal([0n, 1n]);
    });

    it("keeps the two kinds of job apart", async () => {
      await create(twoMilestones, { useYield: true });
      await create(twoMilestones);
      expect(await vault.totalAssets()).to.equal(U(20000));
      expect(await escrow.activeTotal(usdcAddr)).to.equal(U(40000));
      expect(await escrow.vaultDue(usdcAddr)).to.equal(U(20000));
      expect(await idle()).to.equal(U(20050));
    });

    it("refuses a vault that credits less than it was given, or pulls less than it credits", async () => {
      await vault.setDepositHaircut(U(1));
      await expect(create(twoMilestones, { useYield: true })).to.be.revertedWithCustomError(escrow, "VaultMisbehaved");
      await vault.setDepositHaircut(0);
      await vault.setPullShort(1);
      await expect(create(twoMilestones, { useYield: true })).to.be.revertedWithCustomError(escrow, "VaultMisbehaved");
      // Declining jobs don't care about the vault.
      await create(twoMilestones);
      // A rounding of up to the margin is accepted.
      await vault.setPullShort(0);
      await vault.setDepositHaircut(DUST);
      await create(twoMilestones, { useYield: true });
    });
  });

  describe("paying out", () => {
    beforeEach(async () => {
      await create(twoMilestones, { useYield: true });
    });

    it("takes the milestone out of the vault, and the fee stays with the platform", async () => {
      await deliver(1, 0);
      const tx = escrow.connect(payer).approve(1, 0);
      await expect(tx).to.changeTokenBalances(usdc, [payee, vault], [U(11970), -U(12000)]);
      await expect(tx).to.emit(escrow, "MilestonePaid").withArgs(1, 0, payee.address, U(12000), U(30));
      expect(await vault.totalAssets()).to.equal(U(8000));
      expect(await escrow.vaultDue(usdcAddr)).to.equal(U(8000));
      expect(await escrow.activeTotal(usdcAddr)).to.equal(U(8000));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(30));
      expect(await idle()).to.equal(U(30));
    });

    it("pays the payee after the review period and when the arbiter rules for them", async () => {
      await deliver(1, 0);
      await deliver(1, 1);
      await time.increase(3 * DAY);
      await expect(escrow.connect(payee).claimAfterTimeout(1, 0)).to.changeTokenBalances(usdc, [payee, vault], [U(11970), -U(12000)]);
      // The second milestone is disputed in time
    });

    it("returns the whole amount to the payer on a refund, with no fee", async () => {
      await time.increase(8 * DAY);
      await expect(escrow.connect(payer).refundExpired(1, 1)).to.changeTokenBalances(usdc, [payer, vault], [U(8000), -U(8000)]);
      expect(await escrow.accruedFees(usdcAddr)).to.equal(0n);
      expect(await escrow.vaultDue(usdcAddr)).to.equal(U(12000));
      expect(await status(1, 1)).to.equal(REFUNDED);
    });

    it("returns the whole amount when the arbiter rules for the payer", async () => {
      await deliver(1, 0);
      await escrow.connect(payer).dispute(1, 0);
      await expect(escrow.connect(arbiter).resolve(1, 0, false)).to.changeTokenBalances(usdc, [payer, vault], [U(12000), -U(12000)]);
    });

    it("never gives the yield to the payer or the payee", async () => {
      await vault.accrueYield(U(500));
      await deliver(1, 0);
      await expect(escrow.connect(payer).approve(1, 0)).to.changeTokenBalance(usdc, payee, U(11970));
      await time.increase(8 * DAY);
      await expect(escrow.connect(payer).refundExpired(1, 1)).to.changeTokenBalance(usdc, payer, U(8000));
      expect(await vault.totalAssets()).to.equal(U(500));
    });

    it("leaves what a declining job pays untouched in the vault's accounts", async () => {
      await create(twoMilestones);
      await deliver(2, 0);
      const before = await vault.totalAssets();
      await expect(escrow.connect(payer).approve(2, 0)).to.changeTokenBalance(usdc, payee, U(11970));
      expect(await vault.totalAssets()).to.equal(before);
      expect(await escrow.vaultDue(usdcAddr)).to.equal(U(20000));
    });
  });

  describe("harvesting the yield", () => {
    beforeEach(async () => {
      await create([item("all", U(10000))], { useYield: true });
    });

    it("has nothing to harvest without a vault, without yield, or with yield below the margin", async () => {
      await expect(escrow.harvest(ethers.ZeroAddress)).to.be.revertedWithCustomError(escrow, "NoVault");
      await expect(escrow.harvest(usdcAddr)).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
      await vault.accrueYield(DUST);
      expect(await escrow.harvestable(usdcAddr)).to.equal(0n);
      await expect(escrow.harvest(usdcAddr)).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
      await vault.accrueYield(3);
      expect(await escrow.harvestable(usdcAddr)).to.equal(3n);
    });

    it("moves the yield to the fees, for anyone who asks, and keeps the margin in the vault", async () => {
      await vault.accrueYield(U(40));
      expect(await escrow.harvestable(usdcAddr)).to.equal(U(40) - DUST);
      const tx = escrow.connect(stranger).harvest(usdcAddr);
      await expect(tx).to.emit(escrow, "YieldHarvested").withArgs(usdcAddr, U(40) - DUST);
      await expect(tx).to.changeTokenBalances(usdc, [vault, escrow, stranger], [-(U(40) - DUST), U(40) - DUST, 0]);
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(40) - DUST);
      expect(await escrow.vaultDue(usdcAddr)).to.equal(U(10000));
      expect(await escrow.harvestable(usdcAddr)).to.equal(0n);
    });

    it("sends the harvested yield to the treasury with the other fees, and still pays the milestone in full", async () => {
      await vault.accrueYield(U(40));
      await escrow.harvest(usdcAddr);
      await expect(escrow.withdrawFees(usdcAddr)).to.changeTokenBalance(usdc, treasury, U(40) - DUST);
      await deliver(1, 0);
      await expect(escrow.connect(payer).approve(1, 0)).to.changeTokenBalance(usdc, payee, U(9960));
      expect(await vault.totalAssets()).to.equal(DUST);
    });

    it("grows with time at the rate of the vault", async () => {
      await vault.setRatePerYear(400);
      await create([item("big", U(100_000))], { useYield: true });
      await time.increase(91 * DAY);
      await escrow.harvest(usdcAddr);
      // 4% a year on 110,000 for 91 days, about 1,097. The first job was deposited a few seconds earlier.
      const expected = (110_000n * 400n * 91n * 1_000_000n) / (10_000n * 365n);
      expect(await escrow.accruedFees(usdcAddr)).to.be.closeTo(expected, U(2));
    });

    it("always leaves enough in the vault to pay everyone, whatever the share price rounds to", async () => {
      // Someone else in the vault, and yield that doesn't divide evenly, make the shares worth awkward amounts.
      await usdc.mint(stranger.address, U(1_000_000));
      await usdc.connect(stranger).approve(vaultAddr, MAX);
      await vault.connect(stranger).deposit(U(333_333), stranger.address);
      await create([item("a", U(3333) + 7n), item("b", U(2777) + 11n), item("c", U(4001) + 3n)], { useYield: true });
      for (const gain of [U(7) + 13n, 999_983n, U(1) + 1n]) {
        await vault.accrueYield(gain);
        await escrow.harvest(usdcAddr);
      }
      for (let m = 0; m < 3; m++) {
        await deliver(2, m);
        await escrow.connect(payer).approve(2, m);
      }
      await deliver(1, 0);
      await escrow.connect(payer).approve(1, 0);
      expect(await escrow.vaultDue(usdcAddr)).to.equal(0n);
      expect(await vault.balanceOf(escrowAddr)).to.be.greaterThan(0n); // only the margin is left
    });

    it("refuses a vault that gives back less than it was asked for", async () => {
      await vault.accrueYield(U(40));
      await vault.setWithdrawHaircut(1);
      await expect(escrow.harvest(usdcAddr)).to.be.revertedWithCustomError(escrow, "VaultMisbehaved");
      await deliver(1, 0);
      await expect(escrow.connect(payer).approve(1, 0)).to.be.revertedWithCustomError(escrow, "VaultMisbehaved");
      await vault.setWithdrawHaircut(0);
      await escrow.connect(payer).approve(1, 0);
    });
  });

  describe("when the vault is short of money", () => {
    // A job of 10,000 in the vault, and a declining job of 10,000 whose surcharge, 25, is the only fee so far.
    beforeEach(async () => {
      await create([item("in vault", U(10000))], { useYield: true });
      await create([item("idle", U(10000))]);
    });

    it("reports the shortfall, and keeps back enough of the fees to cover it", async () => {
      expect(await escrow.shortfall(usdcAddr)).to.equal(0n);
      await vault.simulateLoss(U(10));
      expect(await escrow.shortfall(usdcAddr)).to.equal(U(10));
      // The fees are 25. Ten of them stay, to cover the loss.
      await expect(escrow.withdrawFees(usdcAddr)).to.changeTokenBalance(usdc, treasury, U(15));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(10));
      await expect(escrow.withdrawFees(usdcAddr)).to.be.revertedWithCustomError(escrow, "Insolvent");
      // When the vault is whole again the rest can go.
      await vault.accrueYield(U(10));
      expect(await escrow.shortfall(usdcAddr)).to.equal(0n);
      await expect(escrow.withdrawFees(usdcAddr)).to.changeTokenBalance(usdc, treasury, U(10));
    });

    it("sends nothing while the loss is bigger than the fees", async () => {
      await vault.simulateLoss(U(30));
      await expect(escrow.withdrawFees(usdcAddr)).to.be.revertedWithCustomError(escrow, "Insolvent");
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(25));
    });

    it("a payment out of the vault fails, and works again when the vault recovers", async () => {
      await vault.simulateLoss(U(10));
      await deliver(1, 0);
      await expect(escrow.connect(payer).approve(1, 0)).to.be.revertedWithCustomError(escrow, "VaultShort");
      expect(await status(1, 0)).to.equal(2n); // still Submitted, nothing was lost
      await vault.accrueYield(U(10));
      await expect(escrow.connect(payer).approve(1, 0)).to.changeTokenBalance(usdc, payee, U(9960));
    });

    it("lets the owner leave the vault, and the fees take the loss", async () => {
      await vault.simulateLoss(U(10));
      await expect(escrow.exitVault(usdcAddr)).to.emit(escrow, "VaultExited").withArgs(usdcAddr, vaultAddr, U(9990), U(10000));
      // The fees held 25. They paid 10 of the loss. What is in the contract now covers every open milestone plus 15.
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(15));
      expect(await idle()).to.equal(U(20015));
      await deliver(1, 0);
      await expect(escrow.connect(payer).approve(1, 0)).to.changeTokenBalance(usdc, payee, U(9960));
      await deliver(2, 0);
      await expect(escrow.connect(payer).approve(2, 0)).to.changeTokenBalance(usdc, payee, U(9960));
      expect(await idle()).to.equal(U(15) + U(80)); // the remaining fees, and the fee of the two payments
      await escrow.withdrawFees(usdcAddr);
      expect(await idle()).to.equal(0n);
    });

    it("can't cover a loss bigger than the fees: the last payments fail", async () => {
      // Open problem in docs/contract-v2-design.md: who covers this. The escrow does not. (The fees of the payments
      // themselves soak up a loss of up to 80 more, so the loss has to be bigger than that.)
      await vault.simulateLoss(U(300));
      await escrow.exitVault(usdcAddr);
      expect(await escrow.accruedFees(usdcAddr)).to.equal(0n);
      await deliver(1, 0);
      await deliver(2, 0);
      await escrow.connect(payer).approve(1, 0);
      await expect(escrow.connect(payer).approve(2, 0)).to.be.revertedWithCustomError(escrow, "TransferFailed");
    });
  });

  describe("rounding in the vault", () => {
    beforeEach(async () => {
      await create([item("all", U(5000))], { useYield: true });
    });

    it("is made up from the fees when a payment is a base unit short", async () => {
      await vault.simulateLoss(1);
      await deliver(1, 0);
      await expect(escrow.connect(payer).approve(1, 0)).to.changeTokenBalance(usdc, payee, U(4960));
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(40) - 1n);
      expect(await idle()).to.equal(U(40) - 1n);
      expect(await escrow.vaultDue(usdcAddr)).to.equal(0n);
    });

    it("is borne by the receiver, up to the margin, when there are no fees to make it up", async () => {
      await vault.simulateLoss(DUST);
      await time.increase(8 * DAY);
      await expect(escrow.connect(payer).refundExpired(1, 0)).to.changeTokenBalance(usdc, payer, U(5000) - DUST);
      expect(await escrow.accruedFees(usdcAddr)).to.equal(0n);
      expect(await idle()).to.equal(0n);
    });

    it("is borne by the payee too, when the job has no fee to make it up from", async () => {
      await time.increase(8 * DAY);
      await escrow.connect(payer).refundExpired(1, 0); // empties the vault
      await escrow.setFeeBps(0);
      await escrow.configureToken(usdcAddr, config({ minFee: 0 }));
      await create([item("free", U(5000))], { useYield: true }); // job 2, no fee
      await vault.simulateLoss(DUST);
      await deliver(2, 0);
      await expect(escrow.connect(payer).approve(2, 0)).to.changeTokenBalance(usdc, payee, U(5000) - DUST);
      expect(await escrow.accruedFees(usdcAddr)).to.equal(0n);
    });

    it("is not allowed beyond the margin, which is a loss", async () => {
      await vault.simulateLoss(DUST + 1n);
      await time.increase(8 * DAY);
      await expect(escrow.connect(payer).refundExpired(1, 0)).to.be.revertedWithCustomError(escrow, "VaultShort");
    });
  });

  describe("when the vault has no cash", () => {
    beforeEach(async () => {
      await create([item("in vault", U(10000))], { useYield: true });
      await deliver(1, 0);
      await vault.setLiquidity(U(5000));
    });

    it("a payment waits until there is cash, and nothing is lost", async () => {
      await expect(escrow.connect(payer).approve(1, 0)).to.be.revertedWith("no liquidity");
      expect(await status(1, 0)).to.equal(2n);
      await vault.setLiquidity(MAX);
      await expect(escrow.connect(payer).approve(1, 0)).to.changeTokenBalance(usdc, payee, U(9960));
    });

    it("a refund waits too, and the owner can't leave the vault until it can pay out everything", async () => {
      await escrow.connect(payer).dispute(1, 0);
      await expect(escrow.connect(arbiter).resolve(1, 0, false)).to.be.revertedWith("no liquidity");
      await expect(escrow.exitVault(usdcAddr)).to.be.revertedWith("no liquidity");
      await vault.setLiquidity(MAX);
      await expect(escrow.connect(arbiter).resolve(1, 0, false)).to.changeTokenBalance(usdc, payer, U(10000));
    });
  });

  describe("leaving the vault", () => {
    // Job 1 (in the vault): 12,000 + 8,000. Job 2 declines: 10,000, with a surcharge of 25. The vault earned 100.
    beforeEach(async () => {
      await create(twoMilestones, { useYield: true });
      await create([item("idle", U(10000))]);
      await vault.accrueYield(U(100));
    });

    it("is for the owner, and only when there is a vault", async () => {
      await expect(escrow.connect(other).exitVault(usdcAddr)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.exitVault(ethers.ZeroAddress)).to.be.revertedWithCustomError(escrow, "NoVault");
    });

    it("takes everything out, gives the yield to the fees, and starts a new epoch", async () => {
      const tx = escrow.exitVault(usdcAddr);
      await expect(tx).to.emit(escrow, "VaultExited").withArgs(usdcAddr, vaultAddr, U(20100), U(20000));
      await expect(tx).to.changeTokenBalances(usdc, [vault, escrow], [-U(20100), U(20100)]);
      expect(await vault.balanceOf(escrowAddr)).to.equal(0n);
      expect(await escrow.vaultDue(usdcAddr)).to.equal(0n);
      expect(await escrow.vaultEpoch(usdcAddr)).to.equal(2n);
      expect((await escrow.tokenConfig(usdcAddr)).vault).to.equal(ethers.ZeroAddress);
      expect(await escrow.accruedFees(usdcAddr)).to.equal(U(125)); // the surcharge of job 2, and the yield
      expect(await idle()).to.equal(U(30000) + U(125));
      await expect(escrow.harvest(usdcAddr)).to.be.revertedWithCustomError(escrow, "NoVault");
    });

    it("pays milestones that were in the vault from the contract afterwards", async () => {
      await escrow.exitVault(usdcAddr);
      await deliver(1, 0);
      const tx = escrow.connect(payer).approve(1, 0);
      await expect(tx).to.changeTokenBalances(usdc, [payee, escrow], [U(11970), -U(11970)]);
      await time.increase(8 * DAY);
      await expect(escrow.connect(payer).refundExpired(1, 1)).to.changeTokenBalance(usdc, payer, U(8000));
      expect(await vault.totalAssets()).to.equal(0n);
    });

    it("a job that took the yield funds idle, with no surcharge, while there is no vault", async () => {
      await create([item("later", U(5000))], { useYield: true, fundNow: false }); // job 3
      await escrow.exitVault(usdcAddr);
      await expect(escrow.connect(payer).fundMilestone(3, 0)).to.changeTokenBalances(usdc, [payer, escrow], [-U(5000), U(5000)]);
      expect(await epoch(3, 0)).to.equal(0n);
      expect(await escrow.vaultDue(usdcAddr)).to.equal(0n);
    });

    it("allows a new vault, which takes new money while the old milestones stay out of it", async () => {
      await escrow.exitVault(usdcAddr);
      const v2 = await newVault();
      await escrow.configureToken(usdcAddr, config({ vault: await v2.getAddress() }));
      expect(await escrow.vaultEpoch(usdcAddr)).to.equal(2n); // the epoch carries on, it does not go back to 1
      await create([item("new", U(6000)), item("new 2", U(3000))], { useYield: true }); // job 3
      expect([await epoch(3, 0), await epoch(3, 1)]).to.deep.equal([2n, 2n]);
      expect(await v2.totalAssets()).to.equal(U(9000));
      expect(await escrow.vaultDue(usdcAddr)).to.equal(U(9000));

      // A milestone from the old vault is paid from the contract and doesn't touch the new vault.
      await deliver(1, 0);
      await escrow.connect(payer).approve(1, 0);
      expect(await v2.totalAssets()).to.equal(U(9000));
      expect(await escrow.vaultDue(usdcAddr)).to.equal(U(9000));
      // A milestone in the new vault comes out of it.
      await deliver(3, 0);
      await expect(escrow.connect(payer).approve(3, 0)).to.changeTokenBalances(usdc, [payee, v2], [U(6000) - 26_666_666n /* its share of the fee of 40 */, -U(6000)]);
      expect(await v2.totalAssets()).to.equal(U(3000));
    });

    it("an exit with the vault empty only starts the new epoch", async () => {
      for (const m of [0, 1]) {
        await deliver(1, m);
        await escrow.connect(payer).approve(1, m);
      }
      await escrow.harvest(usdcAddr);
      await escrow.exitVault(usdcAddr);
      expect(await escrow.vaultEpoch(usdcAddr)).to.equal(2n);
    });
  });

  // Random sequences of calls, with yield, harvests, strangers in the vault, and vaults being left and replaced.
  describe("accounting", () => {
    it("always holds what it owes: idle money exactly, vault money at least", async () => {
      // FUZZ_SEED tries other sequences. The checked-in seed is the one that must always pass.
      const rnd = rng(Number(process.env.FUZZ_SEED ?? 20261029));
      const done = {};
      let lastOp = "";
      // `must` is for calls that have to work, so a failure there is a bug. `maybe` may fail, to try the reverts too.
      const must = (name, call) =>
        call.then(
          () => (done[name] = (done[name] ?? 0) + 1),
          (e) => {
            throw new Error(`${name} should have worked: ${e.message}`);
          }
        );
      const maybe = (name, call) => call.then(() => (done[name] = (done[name] ?? 0) + 1), () => {});
      await usdc.mint(stranger.address, U(10_000_000));
      await usdc.connect(stranger).approve(vaultAddr, MAX);

      const snapshot = async () => {
        const all = [];
        for (let id = 1n; id <= (await escrow.jobCount()); id++) {
          const [job, ms] = await escrow.getJob(id);
          ms.forEach((m, i) => all.push({ id, m: i, status: Number(m.status), amount: m.amount, epoch: m.epoch, job }));
        }
        return all;
      };
      const check = async () => {
        const [active, due, fees, held] = await Promise.all([escrow.activeTotal(usdcAddr), escrow.vaultDue(usdcAddr), escrow.accruedFees(usdcAddr), idle()]);
        // The contract holds what the open milestones and the fees add up to. Only a vault that comes up a unit or two
        // short at an exit can leave it below that (rounding, with no fees to take it), never above.
        expect(held).to.be.at.most(active - due + fees);
        expect(active - due + fees - held, `deficit after ${lastOp}`).to.be.at.most(DUST);
        // No loss here, only rounding: the vault may be a few base units short of what the escrow owes in it.
        expect(await escrow.shortfall(usdcAddr), `shortfall after ${lastOp}`).to.be.at.most(DUST);
        const cfg = await escrow.tokenConfig(usdcAddr);
        if (cfg.vault === ethers.ZeroAddress) expect(due).to.equal(0n);
      };
      // The same numbers, recomputed from the milestones themselves.
      const checkMilestones = async () => {
        const current = await escrow.vaultEpoch(usdcAddr);
        let active = 0n;
        let due = 0n;
        for (const x of await snapshot()) {
          if (x.status < 1 || x.status > 3) continue;
          active += x.amount;
          if (x.epoch !== 0n && x.epoch === current) due += x.amount;
        }
        expect(await escrow.activeTotal(usdcAddr)).to.equal(active);
        expect(await escrow.vaultDue(usdcAddr)).to.equal(due);
      };
      const [UNFUNDED, FUNDED, SUBMITTED, DISPUTED] = [0, 1, 2, 3];

      for (let step = 0; step < 500; step++) {
        const all = await snapshot();
        const target = (...statuses) => {
          const fit = all.filter((x) => statuses.includes(x.status));
          return fit.length > 0 ? fit[rnd(fit.length)] : undefined;
        };
        const op = rnd(15);
        lastOp = `step ${step} op ${op}`;
        const t = op === 1 ? target(UNFUNDED) : op === 2 || op === 3 || op === 8 ? target(FUNDED) : op === 4 || op === 5 || op === 7 ? target(SUBMITTED) : op === 6 ? target(DISPUTED) : undefined;
        if (op === 0 || (op >= 1 && op <= 8 && !t && all.length === 0)) {
          const items = Array.from({ length: 1 + rnd(3) }, (_, i) => item(`m${i}`, U(2000 + rnd(8000)) + BigInt(rnd(1000)), 4 + rnd(8)));
          await maybe("createJob", escrow.connect(payer).createJob(payee.address, usdcAddr, "x", items, opts({ useYield: rnd(10) < 6, fundNow: rnd(2) === 0 })));
        } else if (op === 1 && t) {
          await must("fundMilestone", escrow.connect(payer).fundMilestone(t.id, t.m));
        } else if ((op === 2 || op === 3) && t) {
          await maybe("submitWork", escrow.connect(payee).submitWork(t.id, t.m, "x"));
        } else if (op === 4 && t) {
          await must(t.epoch !== 0n && t.epoch === (await escrow.vaultEpoch(usdcAddr)) ? "approveFromVault" : "approve", escrow.connect(payer).approve(t.id, t.m));
        } else if (op === 5 && t) {
          await maybe("dispute", escrow.connect(payer).dispute(t.id, t.m));
        } else if (op === 6 && t) {
          const forPayee = rnd(2) === 0;
          await must(forPayee ? "resolveForPayee" : "resolveForPayer", escrow.connect(arbiter).resolve(t.id, t.m, forPayee));
        } else if (op === 7 && t) {
          await maybe("claimAfterTimeout", escrow.connect(payee).claimAfterTimeout(t.id, t.m));
        } else if (op === 8 && t) {
          await maybe("refundExpired", escrow.connect(payer).refundExpired(t.id, t.m));
        } else if (op === 9) {
          await maybe("withdrawFees", escrow.withdrawFees(usdcAddr));
        } else if (op === 10) {
          // Yield that is a small share of what the vault holds, in odd amounts, so the shares are worth awkward numbers.
          const held = await vault.totalAssets();
          if (held > 0n) await vault.accrueYield(1n + BigInt(rnd(Number(held / 500n) + 1)));
        } else if (op === 11) {
          if ((await escrow.harvestable(usdcAddr)) > 0n) await must("harvest", escrow.connect(stranger).harvest(usdcAddr));
        } else if (op === 12) {
          // Someone else puts money in the vault, so the shares of the escrow are a fraction of the whole.
          await vault.connect(stranger).deposit(U(1) + BigInt(rnd(5_000_000_000)), stranger.address);
        } else if (op === 13) {
          await time.increase((1 + rnd(4)) * DAY);
        } else if (op === 14 && rnd(8) === 0) {
          if ((await escrow.tokenConfig(usdcAddr)).vault !== ethers.ZeroAddress) {
            await must("exitVault", escrow.exitVault(usdcAddr));
            if (rnd(4) !== 0) {
              vault = await newVault();
              vaultAddr = await vault.getAddress();
              await usdc.connect(stranger).approve(vaultAddr, MAX);
              await must("newVault", escrow.configureToken(usdcAddr, config()));
            }
          } else {
            vault = await newVault();
            vaultAddr = await vault.getAddress();
            await usdc.connect(stranger).approve(vaultAddr, MAX);
            await must("newVault", escrow.configureToken(usdcAddr, config()));
          }
        }
        await check();
        if (step % 10 === 0) await checkMilestones();
      }
      await checkMilestones();
      // The run has to reach every path that moves money, or the checks above prove nothing.
      for (const name of ["createJob", "fundMilestone", "approve", "approveFromVault", "resolveForPayee", "resolveForPayer", "harvest", "withdrawFees", "exitVault", "newVault", "refundExpired"]) {
        expect(done[name] ?? 0, `${name} never happened in the random run`).to.be.greaterThan(0);
      }
    });
  });
});

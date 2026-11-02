const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { REVIEW, item, opts, rules, deploy } = require("./helpers.cjs");

const U = (n) => ethers.parseUnits(String(n), 6); // USDC and EURC have 6 decimals
const E = (n) => ethers.parseEther(String(n));

// What limits the damage of something nobody has found yet: a largest job per token, and a guardian that can only pause.
describe("FreelanceEscrow controls", () => {
  let escrow, owner, payer, payee, arbiter, other, treasury, usdc, usdcAddr, escrowAddr, guardian;

  beforeEach(async () => {
    ({ escrow, owner, payer, payee, arbiter, other, treasury } = await deploy({ free: false }));
    escrowAddr = await escrow.getAddress();
    [, , , , , , guardian] = await ethers.getSigners();
    usdc = await ethers.deployContract("MockERC20", ["Mock USDC", "USDC", 6]);
    usdcAddr = await usdc.getAddress();
    await usdc.mint(payer.address, U(1_000_000));
    await usdc.connect(payer).approve(escrowAddr, ethers.MaxUint256);
  });

  const create = (items, fundNow = true, token = usdcAddr, value = 0n) =>
    escrow.connect(payer).createJob(payee.address, token, "ipfs://spec", items, opts({ fundNow }), { value });

  describe("the largest job", () => {
    beforeEach(async () => {
      await escrow.configureToken(usdcAddr, rules({ minJob: U(2000), minFee: U(40), maxJob: U(10000) }));
    });

    it("lets a job up to the limit through, and refuses one unit more", async () => {
      await create([item("a", U(6000)), item("b", U(4000))]);
      await expect(create([item("a", U(6000)), item("b", U(4000) + 1n)])).to.be.revertedWithCustomError(escrow, "JobTooLarge");
      await expect(create([item("a", U(10001))], false)).to.be.revertedWithCustomError(escrow, "JobTooLarge");
    });

    it("counts the whole job, not each milestone", async () => {
      await expect(create([item("a", U(6000)), item("b", U(6000))])).to.be.revertedWithCustomError(escrow, "JobTooLarge");
    });

    it("makes quote refuse it too, so the app can say so before anyone signs", async () => {
      await escrow.quote(usdcAddr, [U(10000)], false);
      await expect(escrow.quote(usdcAddr, [U(10000) + 1n], false)).to.be.revertedWithCustomError(escrow, "JobTooLarge");
      await expect(escrow.quote(usdcAddr, [U(1999)], false)).to.be.revertedWithCustomError(escrow, "JobTooSmall");
    });

    it("is kept apart for each token", async () => {
      await escrow.configureToken(ethers.ZeroAddress, rules({ minJob: E("0.2"), maxJob: E(5) }));
      await create([item("a", E(5))], true, ethers.ZeroAddress, E(5));
      await expect(create([item("a", E(5) + 1n)], true, ethers.ZeroAddress, E(5) + 1n)).to.be.revertedWithCustomError(escrow, "JobTooLarge");
      await create([item("a", U(10000))]);
    });

    it("only decides about new jobs: a job that exists is funded and paid whatever the limit becomes", async () => {
      await create([item("a", U(5000)), item("b", U(5000))], false);
      await escrow.connect(payer).fundMilestone(1, 0);
      await escrow.configureToken(usdcAddr, rules({ minJob: U(2000), minFee: U(40), maxJob: U(2000) }));
      await escrow.connect(payer).fundMilestone(1, 1);
      await escrow.connect(payee).submitWork(1, 0, "x");
      await escrow.connect(payer).approve(1, 0);
      await expect(create([item("a", U(2001))])).to.be.revertedWithCustomError(escrow, "JobTooLarge");
    });

    it("is changed only by the owner, and can be raised again", async () => {
      await expect(escrow.connect(other).configureToken(usdcAddr, rules({ maxJob: U(1_000_000) }))).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await escrow.configureToken(usdcAddr, rules({ minJob: U(2000), minFee: U(40), maxJob: U(20000) }));
      await create([item("a", U(20000))]);
      expect((await escrow.tokenConfig(usdcAddr)).maxJob).to.equal(U(20000));
    });
  });

  describe("switching a token on", () => {
    it("needs a largest job: zero is not 'no limit', and it can't be below the smallest job", async () => {
      await expect(escrow.configureToken(usdcAddr, rules({ maxJob: 0n }))).to.be.revertedWithCustomError(escrow, "BadConfig");
      await expect(escrow.configureToken(usdcAddr, rules({ minJob: U(2000), minFee: U(40), maxJob: U(1999) }))).to.be.revertedWithCustomError(escrow, "BadConfig");
      await escrow.configureToken(usdcAddr, rules({ minJob: U(2000), minFee: U(40), maxJob: U(2000) }));
    });

    it("lets a token that is switched off carry no limit, and says what it was set to", async () => {
      await expect(escrow.configureToken(usdcAddr, rules({ enabled: false, maxJob: 0n })))
        .to.emit(escrow, "TokenConfigured")
        .withArgs(usdcAddr, false, 0, 0, 0, ethers.ZeroAddress, 0);
      await expect(create([item("a", U(5))])).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
      await expect(escrow.configureToken(usdcAddr, rules({ maxJob: U(7) })))
        .to.emit(escrow, "TokenConfigured")
        .withArgs(usdcAddr, true, 0, 0, 0, ethers.ZeroAddress, U(7));
    });

    it("keeps the old fields where they were, so what reads them by position still works", async () => {
      await escrow.configureToken(usdcAddr, rules({ surchargeBps: 25, minFee: U(40), minJob: U(2000), maxJob: U(9000) }));
      const cfg = await escrow.tokenConfig(usdcAddr);
      expect([cfg[0], cfg[1], cfg[2], cfg[3], cfg[4], cfg[5]]).to.deep.equal([true, 25n, U(40), U(2000), ethers.ZeroAddress, U(9000)]);
    });
  });

  describe("the guardian", () => {
    beforeEach(async () => {
      await escrow.configureToken(usdcAddr, rules());
    });

    it("starts as nobody, and is named by the owner alone", async () => {
      expect(await escrow.guardian()).to.equal(ethers.ZeroAddress);
      await expect(escrow.connect(other).setGuardian(guardian.address)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(guardian).setGuardian(guardian.address)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.setGuardian(guardian.address)).to.emit(escrow, "GuardianSet").withArgs(guardian.address);
      expect(await escrow.guardian()).to.equal(guardian.address);
    });

    it("can pause, which stops new jobs and funding", async () => {
      await escrow.setGuardian(guardian.address);
      await create([item("a", U(100)), item("b", U(100))], false);
      await expect(escrow.connect(guardian).pause()).to.emit(escrow, "PausedSet").withArgs(true);
      expect(await escrow.paused()).to.equal(true);
      await expect(create([item("a", U(100))])).to.be.revertedWithCustomError(escrow, "IsPaused");
      await expect(escrow.connect(payer).fundMilestone(1, 0)).to.be.revertedWithCustomError(escrow, "IsPaused");
    });

    it("leaves payments, approvals, disputes and refunds working while paused", async () => {
      await escrow.setGuardian(guardian.address);
      await create([item("paid", U(100)), item("refunded", U(100), 1), item("disputed", U(100)), item("claimed", U(100))]);
      await escrow.connect(payee).submitWork(1, 0, "x");
      await escrow.connect(payee).submitWork(1, 2, "x");
      await escrow.connect(payee).submitWork(1, 3, "x");
      await escrow.connect(guardian).pause();
      await escrow.connect(payer).approve(1, 0);
      await escrow.connect(payer).dispute(1, 2);
      await escrow.connect(arbiter).resolve(1, 2, false);
      await time.increase(REVIEW + 1);
      await escrow.connect(payee).claimAfterTimeout(1, 3);
      await escrow.connect(payer).refundExpired(1, 1);
    });

    it("can't undo it: only the owner unpauses", async () => {
      await escrow.setGuardian(guardian.address);
      await escrow.connect(guardian).pause();
      await expect(escrow.connect(guardian).setPaused(false)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      expect(await escrow.paused()).to.equal(true);
      await escrow.setPaused(false);
      await create([item("a", U(100))]);
    });

    it("can do nothing else: no rules, no tokens, no vault, no treasury, no ownership", async () => {
      await escrow.setGuardian(guardian.address);
      await create([item("a", U(100))]);
      const g = escrow.connect(guardian);
      for (const attempt of [
        g.setFeeBps(10),
        g.configureToken(usdcAddr, rules({ enabled: false })),
        g.setTreasury(guardian.address),
        g.transferOwnership(guardian.address),
        g.exitVault(usdcAddr),
        g.resolve(1, 0, true),
      ]) await expect(attempt).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(g.withdrawFees(usdcAddr)).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
    });

    it("is nobody's to use but the one named: others can't pause, and a removed guardian can't either", async () => {
      await expect(escrow.connect(other).pause()).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(guardian).pause()).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await escrow.setGuardian(guardian.address);
      await escrow.setGuardian(ethers.ZeroAddress);
      await expect(escrow.connect(guardian).pause()).to.be.revertedWithCustomError(escrow, "NotAllowed");
      // With no guardian named, nobody but the owner can pause.
      await expect(escrow.connect(other).pause()).to.be.revertedWithCustomError(escrow, "NotAllowed");
    });

    it("lets the owner pause too, and pausing twice changes nothing and says nothing", async () => {
      await expect(escrow.pause()).to.emit(escrow, "PausedSet").withArgs(true);
      await expect(escrow.pause()).to.not.emit(escrow, "PausedSet");
      expect(await escrow.paused()).to.equal(true);
    });
  });

  describe("the arbiter", () => {
    it("has to be somebody: with none, a dispute could never be decided", async () => {
      await expect(ethers.deployContract("FreelanceEscrow", [owner.address, ethers.ZeroAddress, treasury.address, REVIEW])).to.be.revertedWith("bad address");
      await expect(ethers.deployContract("FreelanceEscrow", [ethers.ZeroAddress, arbiter.address, treasury.address, REVIEW])).to.be.revertedWith("bad address");
    });
  });
});

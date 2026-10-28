const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { REVIEW, DAY, item, opts, deploy } = require("./helpers.cjs");

const ONE = ethers.parseEther("1");

// The escrow mechanics, with the fees switched off so every amount is exact. Fees are in FreelanceEscrowFees.cjs.
describe("FreelanceEscrow (ETH)", () => {
  let escrow, payer, payee, arbiter, other;

  beforeEach(async () => {
    ({ escrow, payer, payee, arbiter, other } = await deploy());
  });

  const create = (items, fundNow, value = 0n, from = payer) =>
    escrow.connect(from).createJob(payee.address, ethers.ZeroAddress, "ipfs://spec", items, opts({ fundNow }), { value });

  describe("single milestone, funded now", () => {
    beforeEach(async () => {
      await create([item("Everything", ONE)], true, ONE);
    });

    it("pays the payee on the payer's approval", async () => {
      await escrow.connect(payee).submitWork(1, 0, "ipfs://work");
      await expect(escrow.connect(payer).approve(1, 0)).to.changeEtherBalance(payee, ONE);
    });

    it("only the payee can submit, only the payer can approve", async () => {
      await expect(escrow.connect(other).submitWork(1, 0, "x")).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await escrow.connect(payee).submitWork(1, 0, "x");
      await expect(escrow.connect(other).approve(1, 0)).to.be.revertedWithCustomError(escrow, "NotAllowed");
    });

    it("the payee can claim after the review period if the payer is silent", async () => {
      await escrow.connect(payee).submitWork(1, 0, "x");
      await expect(escrow.connect(payee).claimAfterTimeout(1, 0)).to.be.revertedWithCustomError(escrow, "TooEarly");
      await time.increase(REVIEW);
      await expect(escrow.connect(payee).claimAfterTimeout(1, 0)).to.changeEtherBalance(payee, ONE);
    });

    it("the payer cannot dispute after the review period", async () => {
      await escrow.connect(payee).submitWork(1, 0, "x");
      await time.increase(REVIEW);
      await expect(escrow.connect(payer).dispute(1, 0)).to.be.revertedWithCustomError(escrow, "TooLate");
    });

    it("the arbiter resolves disputes either way", async () => {
      await escrow.connect(payee).submitWork(1, 0, "x");
      await escrow.connect(payer).dispute(1, 0);
      await expect(escrow.connect(other).resolve(1, 0, true)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(arbiter).resolve(1, 0, false)).to.changeEtherBalance(payer, ONE);
    });

    it("the payer can refund only after the deadline when nothing was delivered", async () => {
      await expect(escrow.connect(payer).refundExpired(1, 0)).to.be.revertedWithCustomError(escrow, "TooEarly");
      await time.increase(7 * DAY + 1);
      await expect(escrow.connect(payer).refundExpired(1, 0)).to.changeEtherBalance(payer, ONE);
    });

    it("cannot be paid twice", async () => {
      await escrow.connect(payee).submitWork(1, 0, "x");
      await escrow.connect(payer).approve(1, 0);
      await expect(escrow.connect(payer).approve(1, 0)).to.be.revertedWithCustomError(escrow, "WrongStatus");
    });

    it("rejects a milestone that does not exist", async () => {
      await expect(escrow.connect(payee).submitWork(1, 1, "x")).to.be.revertedWithCustomError(escrow, "NoSuchMilestone");
    });
  });

  describe("several milestones", () => {
    const P = ethers.parseEther("0.3");
    const D = ethers.parseEther("0.4");
    const F = ethers.parseEther("0.3");
    const items = [item("Upfront", P, 2), item("Draft", D, 10), item("Delivery", F, 20)];

    it("funds all milestones at once and tracks each on its own", async () => {
      await create(items, true, P + D + F);
      const [job, ms] = await escrow.getJob(1);
      expect(job.payer).to.equal(payer.address);
      expect(ms.map((m) => m.title)).to.deep.equal(["Upfront", "Draft", "Delivery"]);
      expect(ms.map((m) => m.status)).to.deep.equal([1n, 1n, 1n]);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(P + D + F);
    });

    it("pays milestones one by one and leaves the others locked", async () => {
      await create(items, true, P + D + F);
      await escrow.connect(payee).submitWork(1, 0, "ipfs://1");
      await expect(escrow.connect(payer).approve(1, 0)).to.changeEtherBalance(payee, P);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(D + F);
      const ms = (await escrow.getJob(1))[1];
      expect(ms.map((m) => m.status)).to.deep.equal([4n, 1n, 1n]); // Paid, Funded, Funded
    });

    it("a dispute on one milestone does not block the others", async () => {
      await create(items, true, P + D + F);
      await escrow.connect(payee).submitWork(1, 0, "x");
      await escrow.connect(payee).submitWork(1, 1, "y");
      await escrow.connect(payer).dispute(1, 0);
      await expect(escrow.connect(payer).approve(1, 1)).to.changeEtherBalance(payee, D);
      await expect(escrow.connect(arbiter).resolve(1, 0, false)).to.changeEtherBalance(payer, P);
    });

    it("each milestone has its own deadline", async () => {
      await create(items, true, P + D + F);
      await time.increase(3 * DAY); // past the 2 day upfront milestone, within the others
      await expect(escrow.connect(payee).submitWork(1, 0, "late")).to.be.revertedWithCustomError(escrow, "TooLate");
      await escrow.connect(payee).submitWork(1, 1, "on time");
      await expect(escrow.connect(payer).refundExpired(1, 0)).to.changeEtherBalance(payer, P);
      await expect(escrow.connect(payer).refundExpired(1, 2)).to.be.revertedWithCustomError(escrow, "TooEarly");
    });

    it("funds milestones one by one, and the deadline starts at funding", async () => {
      await create(items, false);
      let ms = (await escrow.getJob(1))[1];
      expect(ms.map((m) => m.status)).to.deep.equal([0n, 0n, 0n]);
      await expect(escrow.connect(payee).submitWork(1, 0, "x")).to.be.revertedWithCustomError(escrow, "WrongStatus");

      await time.increase(5 * DAY); // time passes before the payer funds anything
      await escrow.connect(payer).fundMilestone(1, 0, { value: P });
      ms = (await escrow.getJob(1))[1];
      expect(ms[0].status).to.equal(1n);
      expect(ms[0].deadline).to.equal(BigInt(await time.latest()) + BigInt(2 * DAY));
      await escrow.connect(payee).submitWork(1, 0, "ok"); // 5 days after creation, still on time
    });

    it("only the payer funds, with the exact amount, once", async () => {
      await create(items, false);
      await expect(escrow.connect(other).fundMilestone(1, 0, { value: P })).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(payer).fundMilestone(1, 0, { value: P - 1n })).to.be.revertedWith("wrong amount");
      await escrow.connect(payer).fundMilestone(1, 0, { value: P });
      await expect(escrow.connect(payer).fundMilestone(1, 0, { value: P })).to.be.revertedWithCustomError(escrow, "WrongStatus");
    });

    it("emits events with the milestone index", async () => {
      await expect(create(items, true, P + D + F))
        .to.emit(escrow, "JobCreated")
        .withArgs(1, payer.address, payee.address, ethers.ZeroAddress, P + D + F, 3, 0, 0, ethers.ZeroAddress, false)
        .and.to.emit(escrow, "MilestoneFunded");
      await expect(escrow.connect(payee).submitWork(1, 2, "x")).to.emit(escrow, "WorkSubmitted").withArgs(1, 2, "x");
    });
  });

  describe("input checks", () => {
    it("rejects bad milestone lists and amounts", async () => {
      await expect(create([], true, 0n)).to.be.revertedWith("bad milestones");
      await expect(create(Array.from({ length: 21 }, () => item("m", 1n)), true, 21n)).to.be.revertedWith("bad milestones");
      await expect(create([item("m", 0n)], true, 0n)).to.be.revertedWith("bad milestone");
      await expect(create([{ title: "m", amount: 1n, duration: 0 }], true, 1n)).to.be.revertedWith("bad milestone");
    });

    it("rejects a wrong payee", async () => {
      const make = (to) => escrow.connect(payer).createJob(to, ethers.ZeroAddress, "x", [item("m", 1n)], opts({ fundNow: true }), { value: 1n });
      await expect(make(payer.address)).to.be.revertedWith("bad payee");
      await expect(make(ethers.ZeroAddress)).to.be.revertedWith("bad payee");
    });

    it("checks the ETH sent against the total", async () => {
      await expect(create([item("a", 5n), item("b", 5n)], true, 9n)).to.be.revertedWith("wrong amount");
      await expect(create([item("a", 5n)], false, 5n)).to.be.revertedWith("no funds expected");
    });
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const REVIEW = 3 * 24 * 3600;
const DAY = 24 * 3600;
const ONE = ethers.parseEther("1");

const item = (title, amount, days = 7) => ({ title, amount, duration: days * DAY });

describe("FreelanceEscrow (ETH)", () => {
  let escrow, client, freelancer, arbiter, other;

  beforeEach(async () => {
    [client, freelancer, arbiter, other] = await ethers.getSigners();
    escrow = await ethers.deployContract("FreelanceEscrow", [arbiter.address, REVIEW]);
  });

  const create = (items, fundNow, value = 0n, from = client) =>
    escrow.connect(from).createJob(freelancer.address, ethers.ZeroAddress, "ipfs://spec", items, fundNow, { value });

  describe("single milestone, funded now", () => {
    beforeEach(async () => {
      await create([item("Everything", ONE)], true, ONE);
    });

    it("pays freelancer on client approval", async () => {
      await escrow.connect(freelancer).submitWork(1, 0, "ipfs://work");
      await expect(escrow.connect(client).approve(1, 0)).to.changeEtherBalance(freelancer, ONE);
    });

    it("only freelancer can submit, only client can approve", async () => {
      await expect(escrow.connect(other).submitWork(1, 0, "x")).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await escrow.connect(freelancer).submitWork(1, 0, "x");
      await expect(escrow.connect(other).approve(1, 0)).to.be.revertedWithCustomError(escrow, "NotAllowed");
    });

    it("freelancer can claim after the review period if the client is silent", async () => {
      await escrow.connect(freelancer).submitWork(1, 0, "x");
      await expect(escrow.connect(freelancer).claimAfterTimeout(1, 0)).to.be.revertedWithCustomError(escrow, "TooEarly");
      await time.increase(REVIEW);
      await expect(escrow.connect(freelancer).claimAfterTimeout(1, 0)).to.changeEtherBalance(freelancer, ONE);
    });

    it("client cannot dispute after the review period", async () => {
      await escrow.connect(freelancer).submitWork(1, 0, "x");
      await time.increase(REVIEW);
      await expect(escrow.connect(client).dispute(1, 0)).to.be.revertedWithCustomError(escrow, "TooLate");
    });

    it("arbiter resolves disputes either way", async () => {
      await escrow.connect(freelancer).submitWork(1, 0, "x");
      await escrow.connect(client).dispute(1, 0);
      await expect(escrow.connect(other).resolve(1, 0, true)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(arbiter).resolve(1, 0, false)).to.changeEtherBalance(client, ONE);
    });

    it("client can refund only after the deadline when nothing was delivered", async () => {
      await expect(escrow.connect(client).refundExpired(1, 0)).to.be.revertedWithCustomError(escrow, "TooEarly");
      await time.increase(7 * DAY + 1);
      await expect(escrow.connect(client).refundExpired(1, 0)).to.changeEtherBalance(client, ONE);
    });

    it("cannot be paid twice", async () => {
      await escrow.connect(freelancer).submitWork(1, 0, "x");
      await escrow.connect(client).approve(1, 0);
      await expect(escrow.connect(client).approve(1, 0)).to.be.revertedWithCustomError(escrow, "WrongStatus");
    });

    it("rejects a milestone that does not exist", async () => {
      await expect(escrow.connect(freelancer).submitWork(1, 1, "x")).to.be.revertedWithCustomError(escrow, "NoSuchMilestone");
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
      expect(job.client).to.equal(client.address);
      expect(ms.map((m) => m.title)).to.deep.equal(["Upfront", "Draft", "Delivery"]);
      expect(ms.map((m) => m.status)).to.deep.equal([1n, 1n, 1n]);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(P + D + F);
    });

    it("pays milestones one by one and leaves the others locked", async () => {
      await create(items, true, P + D + F);
      await escrow.connect(freelancer).submitWork(1, 0, "ipfs://1");
      await expect(escrow.connect(client).approve(1, 0)).to.changeEtherBalance(freelancer, P);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(D + F);
      const ms = (await escrow.getJob(1))[1];
      expect(ms.map((m) => m.status)).to.deep.equal([4n, 1n, 1n]); // Paid, Funded, Funded
    });

    it("a dispute on one milestone does not block the others", async () => {
      await create(items, true, P + D + F);
      await escrow.connect(freelancer).submitWork(1, 0, "x");
      await escrow.connect(freelancer).submitWork(1, 1, "y");
      await escrow.connect(client).dispute(1, 0);
      await expect(escrow.connect(client).approve(1, 1)).to.changeEtherBalance(freelancer, D);
      await expect(escrow.connect(arbiter).resolve(1, 0, false)).to.changeEtherBalance(client, P);
    });

    it("each milestone has its own deadline", async () => {
      await create(items, true, P + D + F);
      await time.increase(3 * DAY); // past the 2 day upfront milestone, within the others
      await expect(escrow.connect(freelancer).submitWork(1, 0, "late")).to.be.revertedWithCustomError(escrow, "TooLate");
      await escrow.connect(freelancer).submitWork(1, 1, "on time");
      await expect(escrow.connect(client).refundExpired(1, 0)).to.changeEtherBalance(client, P);
      await expect(escrow.connect(client).refundExpired(1, 2)).to.be.revertedWithCustomError(escrow, "TooEarly");
    });

    it("funds milestones one by one, and the deadline starts at funding", async () => {
      await create(items, false);
      let ms = (await escrow.getJob(1))[1];
      expect(ms.map((m) => m.status)).to.deep.equal([0n, 0n, 0n]);
      await expect(escrow.connect(freelancer).submitWork(1, 0, "x")).to.be.revertedWithCustomError(escrow, "WrongStatus");

      await time.increase(5 * DAY); // time passes before the client funds anything
      await escrow.connect(client).fundMilestone(1, 0, { value: P });
      ms = (await escrow.getJob(1))[1];
      expect(ms[0].status).to.equal(1n);
      expect(ms[0].deadline).to.equal(BigInt(await time.latest()) + BigInt(2 * DAY));
      await escrow.connect(freelancer).submitWork(1, 0, "ok"); // 5 days after creation, still on time
    });

    it("only the client funds, with the exact amount, once", async () => {
      await create(items, false);
      await expect(escrow.connect(other).fundMilestone(1, 0, { value: P })).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(client).fundMilestone(1, 0, { value: P - 1n })).to.be.revertedWith("wrong amount");
      await escrow.connect(client).fundMilestone(1, 0, { value: P });
      await expect(escrow.connect(client).fundMilestone(1, 0, { value: P })).to.be.revertedWithCustomError(escrow, "WrongStatus");
    });

    it("emits events with the milestone index", async () => {
      await expect(create(items, true, P + D + F))
        .to.emit(escrow, "JobCreated")
        .withArgs(1, client.address, freelancer.address, ethers.ZeroAddress, P + D + F, 3)
        .and.to.emit(escrow, "MilestoneFunded");
      await expect(escrow.connect(freelancer).submitWork(1, 2, "x")).to.emit(escrow, "WorkSubmitted").withArgs(1, 2, "x");
    });
  });

  describe("input checks", () => {
    it("rejects bad milestone lists and amounts", async () => {
      await expect(create([], true, 0n)).to.be.revertedWith("bad milestones");
      await expect(create(Array.from({ length: 21 }, () => item("m", 1n)), true, 21n)).to.be.revertedWith("bad milestones");
      await expect(create([item("m", 0n)], true, 0n)).to.be.revertedWith("bad milestone");
      await expect(create([{ title: "m", amount: 1n, duration: 0 }], true, 1n)).to.be.revertedWith("bad milestone");
    });

    it("rejects a wrong freelancer", async () => {
      await expect(escrow.connect(client).createJob(client.address, ethers.ZeroAddress, "x", [item("m", 1n)], true, { value: 1n })).to.be.revertedWith("bad freelancer");
      await expect(escrow.connect(client).createJob(ethers.ZeroAddress, ethers.ZeroAddress, "x", [item("m", 1n)], true, { value: 1n })).to.be.revertedWith("bad freelancer");
    });

    it("checks the ETH sent against the total", async () => {
      await expect(create([item("a", 5n), item("b", 5n)], true, 9n)).to.be.revertedWith("wrong amount");
      await expect(create([item("a", 5n)], false, 5n)).to.be.revertedWith("no funds expected");
    });
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { REVIEW, item, opts, deploy } = require("./helpers.cjs");

const ONE = ethers.parseEther("1");

// A verifier is an address the payer names for one job. It can approve submitted milestones, nothing else.
describe("FreelanceEscrow verifier", () => {
  let escrow, payer, payee, arbiter, other, verifier, stranger;

  beforeEach(async () => {
    ({ escrow, payer, payee, arbiter, other } = await deploy());
    [, , , , , , verifier, stranger] = await ethers.getSigners();
  });

  // A job with two milestones of 1 ETH, both funded. `who` is the verifier it is created with.
  const create = (who = verifier.address, fundNow = true) =>
    escrow.connect(payer).createJob(payee.address, ethers.ZeroAddress, "ipfs://spec", [item("a", ONE), item("b", ONE)], opts({ verifier: who, fundNow }), {
      value: fundNow ? 2n * ONE : 0n,
    });
  const deliver = (m = 0) => escrow.connect(payee).submitWork(1, m, "ipfs://work");

  describe("setting it", () => {
    it("is recorded with the job and announced", async () => {
      await expect(create())
        .to.emit(escrow, "JobCreated")
        .withArgs(1, payer.address, payee.address, ethers.ZeroAddress, 2n * ONE, 2, 0, 0, verifier.address);
      expect((await escrow.jobs(1)).verifier).to.equal(verifier.address);
      expect((await escrow.getJob(1))[0].verifier).to.equal(verifier.address);
    });

    it("is optional", async () => {
      await create(ethers.ZeroAddress);
      expect((await escrow.jobs(1)).verifier).to.equal(ethers.ZeroAddress);
    });

    it("can't be the payee, when creating the job or later", async () => {
      await expect(create(payee.address)).to.be.revertedWithCustomError(escrow, "BadVerifier");
      await create();
      await expect(escrow.connect(payer).setVerifier(1, payee.address)).to.be.revertedWithCustomError(escrow, "BadVerifier");
      expect((await escrow.jobs(1)).verifier).to.equal(verifier.address);
    });

    it("only the payer can change it", async () => {
      await create();
      for (const who of [verifier, payee, arbiter, other, stranger]) {
        await expect(escrow.connect(who).setVerifier(1, stranger.address)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      }
      await expect(escrow.connect(payer).setVerifier(99, stranger.address)).to.be.revertedWithCustomError(escrow, "NotAllowed");
    });

    it("the payer can replace or remove it, and the old one loses its power at once", async () => {
      await create();
      await deliver();
      await expect(escrow.connect(payer).setVerifier(1, stranger.address)).to.emit(escrow, "VerifierSet").withArgs(1, stranger.address);
      await expect(escrow.connect(verifier).approve(1, 0)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await expect(escrow.connect(stranger).approve(1, 0)).to.changeEtherBalance(payee, ONE);

      await deliver(1);
      await expect(escrow.connect(payer).setVerifier(1, ethers.ZeroAddress)).to.emit(escrow, "VerifierSet").withArgs(1, ethers.ZeroAddress);
      await expect(escrow.connect(stranger).approve(1, 1)).to.be.revertedWithCustomError(escrow, "NotAllowed");
    });

    it("can be set after the work is already submitted", async () => {
      await create(ethers.ZeroAddress);
      await deliver();
      await expect(escrow.connect(verifier).approve(1, 0)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await escrow.connect(payer).setVerifier(1, verifier.address);
      await expect(escrow.connect(verifier).approve(1, 0)).to.changeEtherBalance(payee, ONE);
    });
  });

  describe("approving", () => {
    beforeEach(create);

    it("pays the payee, not the verifier", async () => {
      await deliver();
      const tx = escrow.connect(verifier).approve(1, 0);
      await expect(tx).to.changeEtherBalances([payee, verifier, escrow], [ONE, 0, -ONE]);
      await expect(tx).to.emit(escrow, "Approved").withArgs(1, 0);
      expect((await escrow.getJob(1))[1][0].status).to.equal(4n); // Paid
    });

    it("the payer can still approve", async () => {
      await deliver();
      await expect(escrow.connect(payer).approve(1, 0)).to.changeEtherBalance(payee, ONE);
    });

    it("takes the same fee as when the payer approves", async () => {
      await escrow.setFeeBps(100); // 1%, for jobs created from now on
      await escrow.connect(payer).createJob(payee.address, ethers.ZeroAddress, "x", [item("a", ONE)], opts({ verifier: verifier.address, fundNow: true }), { value: ONE });
      await escrow.connect(payee).submitWork(2, 0, "x");
      const fee = ONE / 100n;
      const tx = escrow.connect(verifier).approve(2, 0);
      await expect(tx).to.changeEtherBalance(payee, ONE - fee);
      await expect(tx).to.emit(escrow, "MilestonePaid").withArgs(2, 0, payee.address, ONE, fee);
      expect(await escrow.accruedFees(ethers.ZeroAddress)).to.equal(fee);
    });

    it("only when the work has been submitted", async () => {
      // Funded, not submitted
      await expect(escrow.connect(verifier).approve(1, 0)).to.be.revertedWithCustomError(escrow, "WrongStatus");
      // Not funded
      await create(verifier.address, false);
      await expect(escrow.connect(verifier).approve(2, 0)).to.be.revertedWithCustomError(escrow, "WrongStatus");
      // Paid already
      await deliver();
      await escrow.connect(verifier).approve(1, 0);
      await expect(escrow.connect(verifier).approve(1, 0)).to.be.revertedWithCustomError(escrow, "WrongStatus");
    });

    it("not a milestone that does not exist", async () => {
      await expect(escrow.connect(verifier).approve(1, 5)).to.be.revertedWithCustomError(escrow, "NoSuchMilestone");
    });

    it("only for its own job", async () => {
      await create(stranger.address); // job 2, verified by someone else
      await escrow.connect(payee).submitWork(2, 0, "x");
      await expect(escrow.connect(verifier).approve(2, 0)).to.be.revertedWithCustomError(escrow, "NotAllowed");
    });

    it("a job without a verifier lets nobody else approve", async () => {
      await create(ethers.ZeroAddress); // job 2
      await escrow.connect(payee).submitWork(2, 0, "x");
      for (const who of [verifier, stranger, other, payee, arbiter]) {
        await expect(escrow.connect(who).approve(2, 0)).to.be.revertedWithCustomError(escrow, "NotAllowed");
      }
    });
  });

  describe("against a dispute", () => {
    beforeEach(async () => {
      await create();
      await deliver();
    });

    it("can't approve a milestone the payer has disputed", async () => {
      await escrow.connect(payer).dispute(1, 0);
      await expect(escrow.connect(verifier).approve(1, 0)).to.be.revertedWithCustomError(escrow, "WrongStatus");
      // The arbiter still decides it.
      await expect(escrow.connect(arbiter).resolve(1, 0, false)).to.changeEtherBalance(payer, ONE);
    });

    it("if it approves first, the payer can no longer dispute", async () => {
      await escrow.connect(verifier).approve(1, 0);
      await expect(escrow.connect(payer).dispute(1, 0)).to.be.revertedWithCustomError(escrow, "WrongStatus");
    });
  });

  describe("everything else", () => {
    beforeEach(async () => {
      await create();
      await deliver();
    });

    it("is out of its reach", async () => {
      const v = escrow.connect(verifier);
      const no = (call) => expect(call).to.be.revertedWithCustomError(escrow, "NotAllowed");
      await no(v.dispute(1, 0));
      await no(v.resolve(1, 0, true));
      await no(v.claimAfterTimeout(1, 0));
      await no(v.refundExpired(1, 1));
      await no(v.submitWork(1, 1, "x"));
      await no(v.fundMilestone(1, 1));
      await no(v.setVerifier(1, v.runner.address));
      await no(v.configureToken(ethers.ZeroAddress, { enabled: true, surchargeBps: 0, minFee: 0, minJob: 0 }));
      await time.increase(REVIEW);
      await no(v.claimAfterTimeout(1, 0));
    });
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const REVIEW = 3 * 24 * 3600;
const ONE = ethers.parseEther("1");

describe("FreelanceEscrow", () => {
  let escrow, client, freelancer, arbiter, other, deadline;

  beforeEach(async () => {
    [client, freelancer, arbiter, other] = await ethers.getSigners();
    escrow = await ethers.deployContract("FreelanceEscrow", [arbiter.address, REVIEW]);
    deadline = (await time.latest()) + 7 * 24 * 3600;
    await escrow.connect(client).createJob(freelancer.address, deadline, "ipfs://spec", { value: ONE });
  });

  it("pays freelancer on client approval", async () => {
    await escrow.connect(freelancer).submitWork(1, "ipfs://work");
    await expect(escrow.connect(client).approve(1)).to.changeEtherBalance(freelancer, ONE);
  });

  it("only freelancer can submit, only client can approve", async () => {
    await expect(escrow.connect(other).submitWork(1, "x")).to.be.revertedWithCustomError(escrow, "NotAllowed");
    await escrow.connect(freelancer).submitWork(1, "x");
    await expect(escrow.connect(other).approve(1)).to.be.revertedWithCustomError(escrow, "NotAllowed");
  });

  it("freelancer can claim after review period if client is silent", async () => {
    await escrow.connect(freelancer).submitWork(1, "x");
    await expect(escrow.connect(freelancer).claimAfterTimeout(1)).to.be.revertedWithCustomError(escrow, "TooEarly");
    await time.increase(REVIEW);
    await expect(escrow.connect(freelancer).claimAfterTimeout(1)).to.changeEtherBalance(freelancer, ONE);
  });

  it("client cannot dispute after review period", async () => {
    await escrow.connect(freelancer).submitWork(1, "x");
    await time.increase(REVIEW);
    await expect(escrow.connect(client).dispute(1)).to.be.revertedWithCustomError(escrow, "TooLate");
  });

  it("arbiter resolves disputes either way", async () => {
    await escrow.connect(freelancer).submitWork(1, "x");
    await escrow.connect(client).dispute(1);
    await expect(escrow.connect(other).resolve(1, true)).to.be.revertedWithCustomError(escrow, "NotAllowed");
    await expect(escrow.connect(arbiter).resolve(1, false)).to.changeEtherBalance(client, ONE);
  });

  it("client can refund only after deadline when nothing was delivered", async () => {
    await expect(escrow.connect(client).refundExpired(1)).to.be.revertedWithCustomError(escrow, "TooEarly");
    await time.increaseTo(deadline + 1);
    await expect(escrow.connect(client).refundExpired(1)).to.changeEtherBalance(client, ONE);
  });

  it("cannot be paid twice", async () => {
    await escrow.connect(freelancer).submitWork(1, "x");
    await escrow.connect(client).approve(1);
    await expect(escrow.connect(client).approve(1)).to.be.revertedWithCustomError(escrow, "WrongStatus");
  });
});

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const reviewPeriod = 3 * 24 * 3600; // 3 days
  // Arbiter defaults to the deployer; set a trusted third party for real use.
  const escrow = await ethers.deployContract("FreelanceEscrow", [deployer.address, reviewPeriod]);
  await escrow.waitForDeployment();
  console.log("FreelanceEscrow deployed to", await escrow.getAddress());
  const receipt = await escrow.deploymentTransaction().wait();
  console.log("Deploy block", receipt.blockNumber, "(set VITE_ESCROW_DEPLOY_BLOCK to this)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

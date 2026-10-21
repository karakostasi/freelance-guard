const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  const reviewPeriod = 3 * 24 * 3600; // 3 days
  // Arbiter defaults to the deployer; set a trusted third party for real use.
  const escrow = await ethers.deployContract("FreelanceEscrow", [deployer.address, reviewPeriod]);
  await escrow.waitForDeployment();
  console.log("FreelanceEscrow deployed to", await escrow.getAddress());
  const receipt = await escrow.deploymentTransaction().wait();
  // Local chains have no real stablecoins, so deploy a mock EURC to test token jobs with.
  if (["hardhat", "localhost"].includes(hre.network.name)) {
    const eurc = await ethers.deployContract("MockERC20", ["Mock EURC", "EURC", 6]);
    await eurc.waitForDeployment();
    console.log("Mock EURC deployed to", await eurc.getAddress(), "(set VITE_EURC_ADDRESS and EURC_ADDRESS to this; mint with eurc.mint)");
  }
  console.log("Deploy block", receipt.blockNumber, "(set VITE_ESCROW_DEPLOY_BLOCK to this)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

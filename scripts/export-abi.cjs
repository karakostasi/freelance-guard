// Copies the compiled ABI to abi/ so the frontend and backend build without running Hardhat.
const fs = require("fs");
const path = require("path");

const artifact = require("../artifacts/contracts/FreelanceEscrow.sol/FreelanceEscrow.json");
const out = path.join(__dirname, "..", "abi", "FreelanceEscrow.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ abi: artifact.abi }, null, 2) + "\n");
console.log("ABI written to abi/FreelanceEscrow.json");

const { ethers } = require("hardhat");

const PT_ADDR = "0x059f408277BF3c8d612E9EFFa1DB855cbDd7C458";
const CRED_ADDR = "0xF0E9e978DDfF41422b8753B6e56dA1559De96Edc";
const DID_ADDR  = "0xE19905d46c3982e460877e3d54D7e324bE5Af0a8";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const TA = await ethers.getContractFactory("TraceabilityAudit");
  const ta = await TA.deploy(PT_ADDR, CRED_ADDR, DID_ADDR);
  await ta.waitForDeployment();
  const taAddr = await ta.getAddress();
  console.log("✅ TraceabilityAudit:", taAddr);
  console.log("\nUpdate App.jsx ADDR.audit to:", taAddr);
}

main().catch(e => { console.error(e); process.exit(1); });

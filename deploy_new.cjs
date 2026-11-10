// deploy_new.cjs
// Deploys new ProductTransfer + TraceabilityAudit to DIDLab Besu
// Run from your Hardhat project root:
//   node deploy_new.cjs

const { ethers } = require("hardhat");

// ── Existing contract addresses (do NOT redeploy these) ──────────────────────
const EXISTING = {
  trust: "0x0A4502802C243e7C6f464BFDf1D967ec5Ad042d2",
  did:   "0x3559e6f0D6721eA20De0cD5B9cbA7929838aAe24",
  cred:  "0x635d0cA791d1BEA4471FDd10F276693fC1c8EF6f",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // ── 1. Deploy new ProductTransfer ─────────────────────────────────────────
  console.log("\n[1/2] Deploying ProductTransfer...");
  const PT = await ethers.getContractFactory("ProductTransfer");
  const pt = await PT.deploy(EXISTING.cred, EXISTING.did);
  await pt.waitForDeployment();
  const ptAddr = await pt.getAddress();
  console.log("✅ ProductTransfer deployed to:", ptAddr);

  // ── 2. Deploy TraceabilityAudit ───────────────────────────────────────────
  console.log("\n[2/2] Deploying TraceabilityAudit...");
  const TA = await ethers.getContractFactory("TraceabilityAudit");
  const ta = await TA.deploy(ptAddr, EXISTING.cred, EXISTING.did);
  await ta.waitForDeployment();
  const taAddr = await ta.getAddress();
  console.log("✅ TraceabilityAudit deployed to:", taAddr);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────");
  console.log("Update these in App.jsx → const ADDR = {");
  console.log(`  trust: '${EXISTING.trust}',`);
  console.log(`  did:   '${EXISTING.did}',`);
  console.log(`  cred:  '${EXISTING.cred}',`);
  console.log(`  pt:    '${ptAddr}',`);
  console.log(`  audit: '${taAddr}',`);
  console.log("};");
  console.log("──────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// deploy_cred_upgrade.cjs
// Redeploys: AuditLog + CredentialRegistry + ProductTransfer + TraceabilityAudit
// Keeps:     TrustRegistry + DIDRegistry (all DIDs and authorizations are preserved)
//
// Run from your project root (Windows / Ubuntu):
//   node deploy_cred_upgrade.cjs
//
// After running: copy the printed ADDR block into App.jsx and rebuild the UI.

const { ethers } = require("hardhat");

// ── Keep these — TrustRegistry and DIDRegistry are untouched ────────────────
const KEEP = {
  trust: "0x57FD60303b4cB05768ac4d006942B04Fc67176cf",
  did:   "0x12d58eDfB53B24E17dB66Fe6a42fAa6F53aA851b",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Network chain id:", (await ethers.provider.getNetwork()).chainId.toString());

  // ── 1. Fresh AuditLog ────────────────────────────────────────────────────
  console.log("\n[1/4] Deploying AuditLog...");
  const AL = await ethers.getContractFactory("AuditLog");
  const al = await AL.deploy();
  await al.waitForDeployment();
  const alAddr = await al.getAddress();
  console.log("✅ AuditLog:", alAddr);

  // ── 2. New CredentialRegistry (one-credential-per-wallet enforced) ───────
  console.log("\n[2/4] Deploying CredentialRegistry...");
  const CR = await ethers.getContractFactory("CredentialRegistry");
  const cr = await CR.deploy(KEEP.trust, KEEP.did, alAddr);
  await cr.waitForDeployment();
  const crAddr = await cr.getAddress();
  console.log("✅ CredentialRegistry:", crAddr);

  // Register CredentialRegistry in AuditLog so it can write logs
  console.log("   Registering CredentialRegistry in AuditLog...");
  await (await al.registerContract(crAddr, "CredentialRegistry")).wait();
  console.log("   ✅ Registered");

  // ── 3. New ProductTransfer ───────────────────────────────────────────────
  console.log("\n[3/4] Deploying ProductTransfer...");
  const PT = await ethers.getContractFactory("ProductTransfer");
  const pt = await PT.deploy(crAddr, KEEP.did);
  await pt.waitForDeployment();
  const ptAddr = await pt.getAddress();
  console.log("✅ ProductTransfer:", ptAddr);

  // Register ProductTransfer in AuditLog (if ProductTransfer logs to it)
  // Uncomment the next two lines if ProductTransfer uses auditLog.logAction:
  // console.log("   Registering ProductTransfer in AuditLog...");
  // await (await al.registerContract(ptAddr, "ProductTransfer")).wait();

  // ── 4. New TraceabilityAudit ─────────────────────────────────────────────
  console.log("\n[4/4] Deploying TraceabilityAudit...");
  const TA = await ethers.getContractFactory("TraceabilityAudit");
  const ta = await TA.deploy(ptAddr, crAddr, KEEP.did);
  await ta.waitForDeployment();
  const taAddr = await ta.getAddress();
  console.log("✅ TraceabilityAudit:", taAddr);

  // ── Summary — copy this block into App.jsx ───────────────────────────────
  console.log("\n══════════════════════════════════════════════════════");
  console.log("✅  DEPLOYMENT COMPLETE");
  console.log("Copy this into App.jsx → const ADDR = {");
  console.log(`  trust: '${KEEP.trust}',`);
  console.log(`  did:   '${KEEP.did}',`);
  console.log(`  cred:  '${crAddr}',`);
  console.log(`  pt:    '${ptAddr}',`);
  console.log(`  audit: '${taAddr}',`);
  console.log("};");
  console.log("══════════════════════════════════════════════════════");
  console.log("\n⚠️  IMPORTANT: All wallets must re-obtain credentials from Local Government.");
  console.log("    DIDs and authorizations are preserved — only credentials reset.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

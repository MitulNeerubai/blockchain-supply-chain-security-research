const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. AuditLog
  console.log("\n[1/5] Deploying AuditLog...");
  const AL = await ethers.getContractFactory("AuditLog");
  const al = await AL.deploy();
  await al.waitForDeployment();
  const alAddr = await al.getAddress();
  console.log("✅ AuditLog:", alAddr);

  // 2. TrustRegistry
  console.log("\n[2/5] Deploying TrustRegistry...");
  const TR = await ethers.getContractFactory("TrustRegistry");
  const tr = await TR.deploy();
  await tr.waitForDeployment();
  const trAddr = await tr.getAddress();
  console.log("✅ TrustRegistry:", trAddr);

  // 3. DIDRegistry
  console.log("\n[3/5] Deploying DIDRegistry...");
  const DR = await ethers.getContractFactory("DIDRegistry");
  const dr = await DR.deploy(trAddr, alAddr);
  await dr.waitForDeployment();
  const drAddr = await dr.getAddress();
  console.log("✅ DIDRegistry:", drAddr);

  // 4. CredentialRegistry
  console.log("\n[4/5] Deploying CredentialRegistry...");
  const CR = await ethers.getContractFactory("CredentialRegistry");
  const cr = await CR.deploy(trAddr, drAddr, alAddr);
  await cr.waitForDeployment();
  const crAddr = await cr.getAddress();
  console.log("✅ CredentialRegistry:", crAddr);

  // 5. Register CredentialRegistry in AuditLog
  console.log("\nRegistering contracts in AuditLog...");
  await (await al.registerContract(drAddr, "DIDRegistry")).wait();
  await (await al.registerContract(crAddr, "CredentialRegistry")).wait();
  console.log("✅ Registered");

  // 6. ProductTransfer
  console.log("\n[5/5] Deploying ProductTransfer + TraceabilityAudit...");
  const PT = await ethers.getContractFactory("ProductTransfer");
  const pt = await PT.deploy(crAddr, drAddr);
  await pt.waitForDeployment();
  const ptAddr = await pt.getAddress();
  console.log("✅ ProductTransfer:", ptAddr);

  const TA = await ethers.getContractFactory("TraceabilityAudit");
  const ta = await TA.deploy(ptAddr, crAddr, drAddr);
  await ta.waitForDeployment();
  const taAddr = await ta.getAddress();
  console.log("✅ TraceabilityAudit:", taAddr);

  console.log("\n══════════════════════════════════════════");
  console.log("const ADDR = {");
  console.log(`  trust: '${trAddr}',`);
  console.log(`  did:   '${drAddr}',`);
  console.log(`  cred:  '${crAddr}',`);
  console.log(`  pt:    '${ptAddr}',`);
  console.log(`  audit: '${taAddr}',`);
  console.log("};");
  console.log("══════════════════════════════════════════");
}

main().catch((err) => { console.error(err); process.exit(1); });

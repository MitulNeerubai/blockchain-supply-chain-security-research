import hre from "hardhat";
const ethers = hre.ethers;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n=== SSI Supply Chain Deployment ===");
  console.log("Deployer (rootGA):", deployer.address);
  console.log("Network:", hre.network.name);

  console.log("\n1/5 Deploying TrustRegistry...");
  const trustRegistry = await (await ethers.getContractFactory("TrustRegistry")).deploy();
  await trustRegistry.waitForDeployment();
  const trustAddr = await trustRegistry.getAddress();
  console.log("    TrustRegistry:", trustAddr);

  console.log("2/5 Deploying AuditLog...");
  const auditLog = await (await ethers.getContractFactory("AuditLog")).deploy();
  await auditLog.waitForDeployment();
  const auditAddr = await auditLog.getAddress();
  console.log("    AuditLog:", auditAddr);

  console.log("3/5 Deploying DIDRegistry...");
  const didRegistry = await (await ethers.getContractFactory("DIDRegistry")).deploy(trustAddr, auditAddr);
  await didRegistry.waitForDeployment();
  const didAddr = await didRegistry.getAddress();
  console.log("    DIDRegistry:", didAddr);

  console.log("4/5 Deploying CredentialRegistry...");
  const credRegistry = await (await ethers.getContractFactory("CredentialRegistry")).deploy(trustAddr, didAddr, auditAddr);
  await credRegistry.waitForDeployment();
  const credAddr = await credRegistry.getAddress();
  console.log("    CredentialRegistry:", credAddr);

  console.log("5/5 Deploying ProductTransfer...");
  const productTransfer = await (await ethers.getContractFactory("ProductTransfer")).deploy(credAddr, auditAddr);
  await productTransfer.waitForDeployment();
  const ptAddr = await productTransfer.getAddress();
  console.log("    ProductTransfer:", ptAddr);

  console.log("\n=== Registering contracts with AuditLog ===");
  await (await auditLog.registerContract(didAddr,  "DIDRegistry")).wait();
  await (await auditLog.registerContract(credAddr, "CredentialRegistry")).wait();
  await (await auditLog.registerContract(ptAddr,   "ProductTransfer")).wait();
  console.log("    All registered");

  console.log("\n=== DEPLOYMENT COMPLETE — paste these into simulate.mjs ===");
  console.log(`const TRUST_REGISTRY   = "${trustAddr}";`);
  console.log(`const AUDIT_LOG        = "${auditAddr}";`);
  console.log(`const DID_REGISTRY     = "${didAddr}";`);
  console.log(`const CRED_REGISTRY    = "${credAddr}";`);
  console.log(`const PRODUCT_TRANSFER = "${ptAddr}";`);
}

main().catch(err => { console.error(err); process.exit(1); });

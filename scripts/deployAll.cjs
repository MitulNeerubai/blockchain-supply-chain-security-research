const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const TR = await (await ethers.getContractFactory("TrustRegistry")).deploy();
  await TR.waitForDeployment();
  const trustAddr = await TR.getAddress();
  console.log("TrustRegistry:", trustAddr);

  const AL = await (await ethers.getContractFactory("AuditLog")).deploy();
  await AL.waitForDeployment();
  const auditAddr = await AL.getAddress();
  console.log("AuditLog:", auditAddr);

  const DR = await (await ethers.getContractFactory("DIDRegistry")).deploy(trustAddr, auditAddr);
  await DR.waitForDeployment();
  const didAddr = await DR.getAddress();
  console.log("DIDRegistry:", didAddr);

  const CR = await (await ethers.getContractFactory("CredentialRegistry")).deploy(trustAddr, didAddr, auditAddr);
  await CR.waitForDeployment();
  const credAddr = await CR.getAddress();
  console.log("CredentialRegistry:", credAddr);

  const PT = await (await ethers.getContractFactory("ProductTransfer")).deploy(credAddr, didAddr);
  await PT.waitForDeployment();
  const ptAddr = await PT.getAddress();
  console.log("ProductTransfer:", ptAddr);

  await (await AL.registerContract(didAddr, "DIDRegistry")).wait();
  await (await AL.registerContract(credAddr, "CredentialRegistry")).wait();
  await (await AL.registerContract(ptAddr, "ProductTransfer")).wait();

  console.log("\n=== PASTE INTO App.jsx ===");
  console.log(`trust: '${trustAddr}',`);
  console.log(`did:   '${didAddr}',`);
  console.log(`cred:  '${credAddr}',`);
  console.log(`pt:    '${ptAddr}',`);
  console.log(`audit: '${auditAddr}',`);
}
main().catch(err => { console.error(err); process.exit(1); });

import hardhat from "hardhat";
const { ethers } = hardhat;

async function main() {
  const wallets = await ethers.getSigners();
  const rootGA = wallets[0];
  const lg = wallets[1];
  const mf = wallets[2];
  const ds = wallets[3];
  const rt = wallets[4];
  const eu = wallets[5];

  console.log("=== TrustChain Supply Chain Simulation ===\n");

  const DIDRegistry = await ethers.getContractFactory("DIDRegistry");
  const didRegistry = await DIDRegistry.deploy();
  await didRegistry.waitForDeployment();

  const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
  const credentialRegistry = await CredentialRegistry.deploy();
  await credentialRegistry.waitForDeployment();

  const ProductTransfer = await ethers.getContractFactory("ProductTransfer");
  const productTransfer = await ProductTransfer.deploy();
  await productTransfer.waitForDeployment();

  console.log("Step 1: Registering DIDs...");
  await didRegistry.connect(rootGA).registerDID("did:web:rootga.gov", "rootGA-pubkey-001");
  await didRegistry.connect(lg).registerDID("did:web:lg.com", "lg-pubkey-001");
  await didRegistry.connect(mf).registerDID("did:web:manufacturer.com", "mf-pubkey-001");
  await didRegistry.connect(ds).registerDID("did:web:distributor.com", "ds-pubkey-001");
  await didRegistry.connect(rt).registerDID("did:web:retailer.com", "rt-pubkey-001");
  console.log("All DIDs registered!\n");

  console.log("Step 2: Issuing credentials...");
  const credHash = ethers.keccak256(ethers.toUtf8Bytes("manufacturer-license-2024"));
  const tx = await credentialRegistry.connect(lg).issueCredential(mf.address, credHash, 0);
  const receipt = await tx.wait();
  const event = receipt.logs.find(log => {
    try { return credentialRegistry.interface.parseLog(log).name === "CredentialIssued"; }
    catch { return false; }
  });
  const credentialId = credentialRegistry.interface.parseLog(event).args.credentialId;
  console.log("Credential issued to manufacturer!\n");

  console.log("Step 3: Creating product...");
  await productTransfer.connect(mf).createProduct("PROD-001");
  console.log("Product PROD-001 created!\n");

  console.log("Step 4: Supply chain transfers...");
  await productTransfer.connect(mf).transferProduct("PROD-001", ds.address, "Factory-warehouse");
  console.log("MF -> DS transfer done");
  await productTransfer.connect(ds).transferProduct("PROD-001", rt.address, "Warehouse-store");
  console.log("DS -> RT transfer done");
  await productTransfer.connect(rt).deliverProduct("PROD-001");
  console.log("Product delivered!\n");

  console.log("Step 5: Verifying credential...");
  const isValid = await credentialRegistry.verifyCredential(credentialId);
  console.log("Credential valid:", isValid);

  const history = await productTransfer.getTransferHistory("PROD-001");
  console.log("\nTransfer history:", history.length, "transfers recorded");
  console.log("\n=== Simulation Complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

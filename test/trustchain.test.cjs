const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TrustChain", function () {
  let didRegistry, credentialRegistry, productTransfer;
  let rootGA, lg, mf, ds, rt, eu;

  beforeEach(async function () {
    [rootGA, lg, mf, ds, rt, eu] = await ethers.getSigners();

    const DIDRegistry = await ethers.getContractFactory("DIDRegistry");
    didRegistry = await DIDRegistry.deploy();

    const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
    credentialRegistry = await CredentialRegistry.deploy();

    const ProductTransfer = await ethers.getContractFactory("ProductTransfer");
    productTransfer = await ProductTransfer.deploy();
  });

  it("Should register a DID", async function () {
    await didRegistry.connect(rootGA).registerDID("did:web:rootga.gov", "pubkey-001");
    const [owner, , active] = await didRegistry.resolveDID("did:web:rootga.gov");
    expect(owner).to.equal(rootGA.address);
    expect(active).to.equal(true);
  });

  it("Should not register duplicate DID", async function () {
    await didRegistry.connect(rootGA).registerDID("did:web:rootga.gov", "pubkey-001");
    await expect(
      didRegistry.connect(lg).registerDID("did:web:rootga.gov", "pubkey-002")
    ).to.be.revertedWith("DID already registered");
  });

  it("Should issue a credential", async function () {
    const credHash = ethers.keccak256(ethers.toUtf8Bytes("test-credential"));
    const tx = await credentialRegistry.connect(lg).issueCredential(mf.address, credHash, 0);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => {
      try { return credentialRegistry.interface.parseLog(log).name === "CredentialIssued"; }
      catch { return false; }
    });
    const credentialId = credentialRegistry.interface.parseLog(event).args.credentialId;
    const isValid = await credentialRegistry.verifyCredential(credentialId);
    expect(isValid).to.equal(true);
  });

  it("Should revoke a credential", async function () {
    const credHash = ethers.keccak256(ethers.toUtf8Bytes("test-credential"));
    const tx = await credentialRegistry.connect(lg).issueCredential(mf.address, credHash, 0);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => {
      try { return credentialRegistry.interface.parseLog(log).name === "CredentialIssued"; }
      catch { return false; }
    });
    const credentialId = credentialRegistry.interface.parseLog(event).args.credentialId;
    await credentialRegistry.connect(lg).revokeCredential(credentialId);
    const isValid = await credentialRegistry.verifyCredential(credentialId);
    expect(isValid).to.equal(false);
  });

  it("Should create a product", async function () {
    await productTransfer.connect(mf).createProduct("PROD-001");
    const [manufacturer, , ] = await productTransfer.getProduct("PROD-001");
    expect(manufacturer).to.equal(mf.address);
  });

  it("Should transfer a product", async function () {
    await productTransfer.connect(mf).createProduct("PROD-001");
    await productTransfer.connect(mf).transferProduct("PROD-001", ds.address, "Factory");
    const [, currentOwner, ] = await productTransfer.getProduct("PROD-001");
    expect(currentOwner).to.equal(ds.address);
  });

  it("Should track transfer history", async function () {
    await productTransfer.connect(mf).createProduct("PROD-001");
    await productTransfer.connect(mf).transferProduct("PROD-001", ds.address, "Factory");
    await productTransfer.connect(ds).transferProduct("PROD-001", rt.address, "Warehouse");
    const history = await productTransfer.getTransferHistory("PROD-001");
    expect(history.length).to.equal(2);
  });

  it("Should deliver a product", async function () {
    await productTransfer.connect(mf).createProduct("PROD-001");
    await productTransfer.connect(mf).transferProduct("PROD-001", ds.address, "Factory");
    await productTransfer.connect(ds).deliverProduct("PROD-001");
    const [, , status] = await productTransfer.getProduct("PROD-001");
    expect(status).to.equal(2);
  });

  it("Should recall a product", async function () {
    await productTransfer.connect(mf).createProduct("PROD-001");
    await productTransfer.connect(mf).recallProduct("PROD-001");
    const [, , status] = await productTransfer.getProduct("PROD-001");
    expect(status).to.equal(3);
  });

  it("Should deactivate a DID", async function () {
    await didRegistry.connect(mf).registerDID("did:web:manufacturer.com", "pubkey-001");
    await didRegistry.connect(mf).deactivateDID("did:web:manufacturer.com");
    const isActive = await didRegistry.isActiveDID("did:web:manufacturer.com");
    expect(isActive).to.equal(false);
  });
});

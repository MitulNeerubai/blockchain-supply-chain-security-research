const { expect } = require("chai");
const hre = require("hardhat");
const ethers = hre.ethers;

describe("SSI Supply Chain — 5 Contract Suite", function () {
  let rootGA, lg, mf, dt, rt, attacker;
  let trustRegistry, auditLog, didRegistry, credRegistry, productTransfer;
  let mfLicCredId, dtCredId, rtCredId;

  before(async function () {
    [rootGA, lg, mf, dt, rt, attacker] = await ethers.getSigners();

    const Trust = await ethers.getContractFactory("TrustRegistry");
    trustRegistry = await Trust.deploy();

    const Audit = await ethers.getContractFactory("AuditLog");
    auditLog = await Audit.deploy();

    const DID = await ethers.getContractFactory("DIDRegistry");
    didRegistry = await DID.deploy(
      await trustRegistry.getAddress(),
      await auditLog.getAddress()
    );

    const Cred = await ethers.getContractFactory("CredentialRegistry");
    credRegistry = await Cred.deploy(
      await trustRegistry.getAddress(),
      await didRegistry.getAddress(),
      await auditLog.getAddress()
    );

    const PT = await ethers.getContractFactory("ProductTransfer");
    productTransfer = await PT.deploy(
      await credRegistry.getAddress(),
      await auditLog.getAddress()
    );

    await auditLog.registerContract(await didRegistry.getAddress(),     "DIDRegistry");
    await auditLog.registerContract(await credRegistry.getAddress(),    "CredentialRegistry");
    await auditLog.registerContract(await productTransfer.getAddress(), "ProductTransfer");
  });

  describe("TrustRegistry", function () {
    it("rootGA is the deployer", async function () {
      expect(await trustRegistry.rootGA()).to.equal(rootGA.address);
    });

    it("rootGA can authorize issuers", async function () {
      await trustRegistry.authorizeIssuer(lg.address, "LocalGovt");
      await trustRegistry.authorizeIssuer(mf.address, "Manufacturer");
      await trustRegistry.authorizeIssuer(dt.address, "Distributor");
      await trustRegistry.authorizeIssuer(rt.address, "Retailer");
      expect(await trustRegistry.isAuthorizedIssuer(lg.address)).to.be.true;
      expect(await trustRegistry.isAuthorizedIssuer(mf.address)).to.be.true;
    });

    it("non-rootGA CANNOT authorize issuers", async function () {
      await expect(
        trustRegistry.connect(attacker).authorizeIssuer(attacker.address, "Hacker")
      ).to.be.revertedWith("TrustRegistry: caller is not rootGA");
    });

    it("rootGA can revoke an issuer", async function () {
      await trustRegistry.authorizeIssuer(attacker.address, "Temp");
      await trustRegistry.revokeIssuer(attacker.address);
      expect(await trustRegistry.isAuthorizedIssuer(attacker.address)).to.be.false;
    });
  });

  describe("DIDRegistry", function () {
    it("authorized actors can register DIDs", async function () {
      await didRegistry.connect(lg).registerDID("LocalGovt");
      await didRegistry.connect(mf).registerDID("Manufacturer");
      await didRegistry.connect(dt).registerDID("Distributor");
      await didRegistry.connect(rt).registerDID("Retailer");
      expect(await didRegistry.isActiveDID(lg.address)).to.be.true;
    });

    it("unauthorized address CANNOT register DID", async function () {
      await expect(
        didRegistry.connect(attacker).registerDID("Hacker")
      ).to.be.revertedWith("DIDRegistry: caller not authorized in TrustRegistry");
    });

    it("DID string starts with did:besu:0x", async function () {
      const did = await didRegistry.getDID(mf.address);
      expect(did).to.match(/^did:besu:0x/);
    });

    it("cannot register DID twice", async function () {
      await expect(
        didRegistry.connect(lg).registerDID("LocalGovt")
      ).to.be.revertedWith("DIDRegistry: DID already registered for this address");
    });
  });

  describe("CredentialRegistry", function () {
    it("authorized issuer with DID can issue ManufacturingLicense", async function () {
      const tx = await credRegistry.connect(lg).issueCredential(mf.address, "ManufacturingLicense", 365);
      const receipt = await tx.wait();
      const event = receipt.logs
        .map(l => { try { return credRegistry.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "CredentialIssued");
      mfLicCredId = event.args.credentialId;
      expect(mfLicCredId).to.not.equal(ethers.ZeroHash);
    });

    it("unauthorized issuer CANNOT issue a credential", async function () {
      await expect(
        credRegistry.connect(attacker).issueCredential(mf.address, "FakeCredential", 30)
      ).to.be.revertedWith("CredentialRegistry: issuer not authorized in TrustRegistry");
    });

    it("issue TradeLicense for DT and RT", async function () {
      let tx = await credRegistry.connect(mf).issueCredential(dt.address, "TradeLicense", 180);
      let receipt = await tx.wait();
      dtCredId = receipt.logs
        .map(l => { try { return credRegistry.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "CredentialIssued").args.credentialId;

      tx = await credRegistry.connect(dt).issueCredential(rt.address, "TradeLicense", 180);
      receipt = await tx.wait();
      rtCredId = receipt.logs
        .map(l => { try { return credRegistry.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "CredentialIssued").args.credentialId;

      expect(dtCredId).to.not.equal(ethers.ZeroHash);
      expect(rtCredId).to.not.equal(ethers.ZeroHash);
    });

    it("8-point verify passes for valid credential", async function () {
      const [valid, reason] = await credRegistry.verifyCredential(mfLicCredId, mf.address, "ManufacturingLicense", 0);
      expect(valid).to.be.true;
      expect(reason).to.equal("");
    });

    it("CHECK2: revoked credential fails", async function () {
      const tx = await credRegistry.connect(lg).issueCredential(mf.address, "TempLicense", 10);
      const receipt = await tx.wait();
      const tempId = receipt.logs
        .map(l => { try { return credRegistry.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "CredentialIssued").args.credentialId;
      await credRegistry.connect(lg).revokeCredential(tempId);
      const [valid, reason] = await credRegistry.verifyCredential(tempId, mf.address, "", 0);
      expect(valid).to.be.false;
      expect(reason).to.include("CHECK2_FAIL");
    });

    it("CHECK4: cascading revocation when issuer is revoked", async function () {
      const signers = await ethers.getSigners();
      const tempIssuer = signers[6];
      await trustRegistry.authorizeIssuer(tempIssuer.address, "TempIssuer");
      await didRegistry.connect(tempIssuer).registerDID("TempIssuer");
      const tx = await credRegistry.connect(tempIssuer).issueCredential(mf.address, "TempCred2", 30);
      const receipt = await tx.wait();
      const tempCredId = receipt.logs
        .map(l => { try { return credRegistry.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "CredentialIssued").args.credentialId;
      await trustRegistry.revokeIssuer(tempIssuer.address);
      const [valid, reason] = await credRegistry.verifyCredential(tempCredId, mf.address, "", 0);
      expect(valid).to.be.false;
      expect(reason).to.include("CHECK4_FAIL");
    });

    it("CHECK7: wrong credential type fails", async function () {
      const [valid, reason] = await credRegistry.verifyCredential(mfLicCredId, mf.address, "TradeLicense", 0);
      expect(valid).to.be.false;
      expect(reason).to.include("CHECK7_FAIL");
    });
  });

  describe("ProductTransfer", function () {
    let productId;
    const secret = "TEST_SECRET_XYZ";
    const secret2 = "DT_TO_RT_HANDSHAKE";

    it("MF creates product with valid ManufacturingLicense", async function () {
      const tx = await productTransfer.connect(mf).createProduct("Widget-001", mfLicCredId);
      const receipt = await tx.wait();
      const event = receipt.logs
        .map(l => { try { return productTransfer.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "ProductCreated");
      productId = event.args.productId;
      expect(productId).to.not.equal(0n);
    });

    it("credential is linked to product after creation", async function () {
      const cred = await credRegistry.getCredential(mfLicCredId);
      expect(cred.productLinked).to.be.true;
      expect(cred.linkedProductId).to.equal(productId);
    });

    it("CHECK8: credential linked to wrong product fails", async function () {
      const [valid, reason] = await credRegistry.verifyCredential(mfLicCredId, mf.address, "ManufacturingLicense", 999n);
      expect(valid).to.be.false;
      expect(reason).to.include("CHECK8_FAIL");
    });

    it("MF commits transfer to DT with secret hash", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes(secret));
      await expect(
        productTransfer.connect(mf).commitTransfer(productId, hash, dt.address, dtCredId)
      ).to.emit(productTransfer, "TransferCommitted");
    });

    it("wrong secret CANNOT claim", async function () {
      await expect(
        productTransfer.connect(dt).claimTransfer(productId, "WRONG_SECRET")
      ).to.be.revertedWith("ProductTransfer: secret does not match commitment (wrong secret)");
    });

    it("wrong recipient CANNOT claim even with correct secret", async function () {
      await expect(
        productTransfer.connect(attacker).claimTransfer(productId, secret)
      ).to.be.revertedWith("ProductTransfer: caller is not the pending recipient");
    });

    it("correct recipient with correct secret CAN claim", async function () {
      await expect(
        productTransfer.connect(dt).claimTransfer(productId, secret)
      ).to.emit(productTransfer, "TransferClaimed");
      const p = await productTransfer.getProduct(productId);
      expect(p.currentHolder).to.equal(dt.address);
    });

    it("DT transfers to RT — RT becomes final holder with Delivered status", async function () {
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes(secret2));
      await productTransfer.connect(dt).commitTransfer(productId, hash2, rt.address, rtCredId);
      await productTransfer.connect(rt).claimTransfer(productId, secret2);
      const p = await productTransfer.getProduct(productId);
      expect(p.currentHolder).to.equal(rt.address);
      expect(p.status).to.equal(0n); // Delivered
    });
  });

  describe("AuditLog", function () {
    it("has recorded all actions", async function () {
      const total = await auditLog.totalEntries();
      expect(total).to.be.gt(0n);
      console.log("    Total audit entries:", total.toString());
    });

    it("unregistered address CANNOT write to audit log", async function () {
      await expect(
        auditLog.connect(attacker).logAction(attacker.address, "HACK", "data")
      ).to.be.revertedWith("AuditLog: caller not a registered contract");
    });

    it("non-rootGA CANNOT register a contract with AuditLog", async function () {
      await expect(
        auditLog.connect(attacker).registerContract(attacker.address, "FakeContract")
      ).to.be.revertedWith("AuditLog: caller is not rootGA");
    });
  });
});

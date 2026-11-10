const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 86400;
const Status = { InStock: 0n, InTransit: 1n, Delivered: 2n, Cancelled: 3n };

async function deployAll() {
  const [rootGA, lg, mf, dt, rt, mf2, dt2, rt2, outsider] = await ethers.getSigners();
  const audit = await (await ethers.getContractFactory("AuditLog")).deploy();
  const trust = await (await ethers.getContractFactory("TrustRegistry")).deploy();
  const did   = await (await ethers.getContractFactory("DIDRegistry")).deploy(trust, audit);
  const cred  = await (await ethers.getContractFactory("CredentialRegistry")).deploy(trust, did, audit);
  const pt    = await (await ethers.getContractFactory("ProductTransfer")).deploy(cred, did, audit);
  const ta    = await (await ethers.getContractFactory("TraceabilityAudit")).deploy(pt, cred, did);
  for (const c of [did, cred, pt]) await audit.registerContract(c, "c");
  return { rootGA, lg, mf, dt, rt, mf2, dt2, rt2, outsider, audit, trust, did, cred, pt, ta };
}

const expiry = async (days = 365) => (await time.latest()) + days * DAY;

/** Registers everyone and builds the full licence chain LG→MF→DT→RT. */
async function fullChain() {
  const f = await deployAll();
  const { lg, mf, dt, rt, did, trust, cred } = f;
  await did.connect(lg).registerDID("LocalGovt", "City of Kansas");
  await did.connect(mf).registerDID("Manufacturer", "Acme Corp");
  await did.connect(dt).registerDID("Distributor", "FastShip");
  await did.connect(rt).registerDID("Retailer", "CornerShop");
  await trust.authorizeIssuer(lg, "LocalGovt");
  await cred.connect(lg).issueCredential(mf, await expiry());
  await cred.connect(mf).issueCredential(dt, await expiry());
  await cred.connect(dt).issueCredential(rt, await expiry());
  return f;
}

async function createProduct(pt, mf, name = "Widget") {
  const tx = await pt.connect(mf).createProduct(name, "", 10, "desc", "BATCH-1");
  const rc = await tx.wait();
  return rc.logs.map(l => { try { return pt.interface.parseLog(l); } catch { return null; } })
    .find(e => e?.name === "ProductCreated").args.id;
}

describe("DIDRegistry", () => {
  it("stores role + company name on-chain", async () => {
    const { did, mf } = await deployAll();
    await did.connect(mf).registerDID("Manufacturer", "Acme Corp");
    const d = await did.getDID(mf);
    expect(d.companyName).to.equal("Acme Corp");
    expect(d.role).to.equal("Manufacturer");
    expect(d.did).to.match(/^did:besu:0x/);
    expect(d.active).to.be.true;
  });

  it("rejects duplicate company names (case-insensitive)", async () => {
    const { did, mf, dt } = await deployAll();
    await did.connect(mf).registerDID("Manufacturer", "Acme Corp");
    expect(await did.isNameAvailable("ACME corp")).to.be.false;
    await expect(did.connect(dt).registerDID("Distributor", "acme CORP"))
      .to.be.revertedWith("DIDRegistry: company name already taken");
  });

  it("rejects invalid roles, bad names, double registration and rootGA", async () => {
    const { did, rootGA, mf } = await deployAll();
    await expect(did.connect(mf).registerDID("Hacker", "X Co")).to.be.revertedWith("DIDRegistry: invalid role");
    await expect(did.connect(mf).registerDID("Manufacturer", " Acme")).to.be.revertedWith("DIDRegistry: company name has leading or trailing spaces");
    await expect(did.connect(mf).registerDID("Manufacturer", "A")).to.be.revertedWith("DIDRegistry: company name must be 2-64 characters");
    await expect(did.connect(rootGA).registerDID("LocalGovt", "Root")).to.be.revertedWith("DIDRegistry: rootGA does not register a DID");
    await did.connect(mf).registerDID("Manufacturer", "Acme");
    await expect(did.connect(mf).registerDID("Manufacturer", "Acme 2")).to.be.revertedWith("DIDRegistry: already registered");
  });

  it("returns the full directory", async () => {
    const { did } = await fullChain();
    const all = await did.getAllDIDs();
    expect(all.map(d => d.companyName)).to.deep.equal(["City of Kansas", "Acme Corp", "FastShip", "CornerShop"]);
  });
});

describe("TrustRegistry", () => {
  it("only rootGA can grant / revoke the LG licence", async () => {
    const { trust, lg, outsider } = await deployAll();
    await expect(trust.connect(outsider).authorizeIssuer(lg, "LocalGovt")).to.be.revertedWith("TrustRegistry: caller is not rootGA");
    await trust.authorizeIssuer(lg, "LocalGovt");
    await expect(trust.authorizeIssuer(lg, "LocalGovt")).to.be.revertedWith("TrustRegistry: already authorized");
    await trust.revokeIssuer(lg);
    await trust.authorizeIssuer(lg, "LocalGovt");
    expect(await trust.getIssuers()).to.deep.equal([lg.address]); // no duplicates after re-authorization
  });
});

describe("CredentialRegistry — licence chain", () => {
  it("builds LG→MF→DT→RT with the right licence types", async () => {
    const { cred, mf, dt, rt, lg } = await fullChain();
    for (const [who, issuer, type] of [[mf, lg, "ManufacturingLicense"], [dt, mf, "TradeLicense"], [rt, dt, "TradeLicense"]]) {
      expect(await cred.isCredentialValid(who)).to.be.true;
      expect(await cred.licensedBy(who)).to.equal(issuer.address);
      const c = await cred.getCredential(await cred.activeCredentialOf(who));
      expect(c.credType).to.equal(type);
    }
  });

  it("LG must be licensed by rootGA first", async () => {
    const { did, cred, lg, mf } = await deployAll();
    await did.connect(lg).registerDID("LocalGovt", "City");
    await did.connect(mf).registerDID("Manufacturer", "Acme");
    await expect(cred.connect(lg).issueCredential(mf, await expiry()))
      .to.be.revertedWith("CredentialRegistry: Local Government is not licensed by rootGA");
  });

  it("each role can only licence the next role down", async () => {
    const { did, cred, lg, mf, dt, rt, mf2, dt2, rt2 } = await fullChain();
    await did.connect(mf2).registerDID("Manufacturer", "Beta Mfg");
    await did.connect(dt2).registerDID("Distributor", "Beta Dist");
    await did.connect(rt2).registerDID("Retailer", "Beta Shop");
    const e = await expiry();
    await expect(cred.connect(lg).issueCredential(dt2, e)).to.be.revertedWith("CredentialRegistry: Local Government can only licence Manufacturers");
    await expect(cred.connect(mf).issueCredential(rt2, e)).to.be.revertedWith("CredentialRegistry: Manufacturers can only licence Distributors");
    await expect(cred.connect(mf).issueCredential(mf2, e)).to.be.revertedWith("CredentialRegistry: Manufacturers can only licence Distributors");
    await expect(cred.connect(dt).issueCredential(dt2, e)).to.be.revertedWith("CredentialRegistry: Distributors can only licence Retailers");
    await expect(cred.connect(rt).issueCredential(rt2, e)).to.be.revertedWith("CredentialRegistry: your role cannot issue licences");
    // an unlicensed manufacturer cannot licence anyone
    await expect(cred.connect(mf2).issueCredential(dt2, e)).to.be.revertedWith("CredentialRegistry: your Manufacturing License is not active");
  });

  it("one live licence per wallet", async () => {
    const { did, cred, mf, dt, mf2, lg } = await fullChain();
    await did.connect(mf2).registerDID("Manufacturer", "Beta Mfg");
    await cred.connect(lg).issueCredential(mf2, await expiry());
    await expect(cred.connect(mf2).issueCredential(dt, await expiry()))
      .to.be.revertedWith("CredentialRegistry: holder already has an active licence. Revoke it first.");
  });

  it("cascading revocation: revoking the LG suspends the whole chain, re-granting restores it", async () => {
    const { trust, cred, lg, mf, dt, rt } = await fullChain();
    await trust.revokeIssuer(lg);
    for (const w of [mf, dt, rt]) expect(await cred.isCredentialValid(w)).to.be.false;
    const [ok, reason] = await cred.verifyCredential(await (await cred.getCredentialsByHolder(dt))[0], dt, "TradeLicense");
    expect(ok).to.be.false; expect(reason).to.include("CHECK6_FAIL");
    await trust.authorizeIssuer(lg, "LocalGovt");
    for (const w of [mf, dt, rt]) expect(await cred.isCredentialValid(w)).to.be.true;
  });

  it("only the issuer can revoke; revoked/expired licences are invalid", async () => {
    const { cred, mf, dt, rt, lg } = await fullChain();
    const dtCred = await cred.activeCredentialOf(dt);
    await expect(cred.connect(lg).revokeCredential(dtCred)).to.be.revertedWith("CredentialRegistry: only issuer can revoke");
    await cred.connect(mf).revokeCredential(dtCred);
    expect(await cred.isCredentialValid(dt)).to.be.false;
    expect(await cred.isCredentialValid(rt)).to.be.false; // RT was licensed by DT
    // re-issue supersedes the old one
    await cred.connect(mf).issueCredential(dt, (await time.latest()) + 10);
    expect(await cred.isCredentialValid(dt)).to.be.true;
    await time.increase(20);
    expect(await cred.isCredentialValid(dt)).to.be.false;
  });
});

describe("ProductTransfer", () => {
  it("full flow MF → DT → RT, audit verified", async () => {
    const { pt, ta, mf, dt, rt } = await fullChain();
    const id = await createProduct(pt, mf);
    await pt.connect(mf).shipTo(id, dt);
    expect((await pt.getProduct(id)).status).to.equal(Status.InTransit);
    expect(await pt.getShipmentsTo(dt)).to.deep.equal([id]);
    await pt.connect(dt).confirmReceipt(id);
    await pt.connect(dt).shipTo(id, rt);
    await pt.connect(rt).confirmReceipt(id);
    const p = await pt.getProduct(id);
    expect(p.currentHolder).to.equal(rt.address);
    expect(p.status).to.equal(Status.Delivered);
    expect(await pt.ownerOf(id)).to.equal(rt.address);
    const r = await ta.auditProduct(id);
    expect(r.verified, r.failReason).to.be.true;
    expect([r.manufacturer, r.distributor, r.retailer]).to.deep.equal([mf.address, dt.address, rt.address]);
  });

  it("only Manufacturers with a valid licence can create products", async () => {
    const { pt, dt, did, mf2 } = await fullChain();
    await expect(pt.connect(dt).createProduct("X", "", 1, "", "")).to.be.revertedWith("ProductTransfer: only Manufacturers can create products");
    await did.connect(mf2).registerDID("Manufacturer", "Beta Mfg");
    await expect(pt.connect(mf2).createProduct("X", "", 1, "", "")).to.be.revertedWith("ProductTransfer: no valid credential");
  });

  it("can only ship to partners you licensed", async () => {
    const { pt, did, cred, lg, mf, dt, rt, mf2, dt2 } = await fullChain();
    await did.connect(mf2).registerDID("Manufacturer", "Beta Mfg");
    await did.connect(dt2).registerDID("Distributor", "Beta Dist");
    await cred.connect(lg).issueCredential(mf2, await expiry());
    await cred.connect(mf2).issueCredential(dt2, await expiry());
    const id = await createProduct(pt, mf);
    await expect(pt.connect(mf).shipTo(id, dt2)).to.be.revertedWith("ProductTransfer: recipient is not licensed by you");
    await expect(pt.connect(mf).shipTo(id, rt)).to.be.revertedWith("ProductTransfer: recipient is not licensed by you");
    await pt.connect(mf).shipTo(id, dt);
  });

  it("direct ERC-721 transfers are blocked", async () => {
    const { pt, mf, dt } = await fullChain();
    const id = await createProduct(pt, mf);
    await expect(pt.connect(mf).transferFrom(mf, dt, id)).to.be.revertedWith("ProductTransfer: use shipTo / confirmReceipt");
  });

  it("cancel shipment, force recall (MF and DT), reclaim", async () => {
    const { pt, cred, ta, mf, dt, rt } = await fullChain();
    const id = await createProduct(pt, mf);
    await pt.connect(mf).shipTo(id, dt);
    await pt.connect(mf).cancelShipment(id);
    expect((await pt.getProduct(id)).status).to.equal(Status.InStock);

    await pt.connect(mf).shipTo(id, dt); await pt.connect(dt).confirmReceipt(id);
    await pt.connect(dt).shipTo(id, rt); await pt.connect(rt).confirmReceipt(id);
    await pt.connect(dt).forceRecall(id);                       // DT pulls back from RT
    expect((await pt.getProduct(id)).currentHolder).to.equal(dt.address);
    expect((await ta.auditProduct(id)).verified).to.be.false;

    await pt.connect(mf).forceRecall(id);                       // MF pulls back from DT
    expect((await pt.getProduct(id)).currentHolder).to.equal(mf.address);

    await pt.connect(mf).shipTo(id, dt); await pt.connect(dt).confirmReceipt(id);
    await cred.connect(mf).revokeCredential(await cred.activeCredentialOf(dt));
    await pt.reclaimProduct(id);                                // anyone can trigger
    expect((await pt.getProduct(id)).currentHolder).to.equal(mf.address);
  });

  it("writes to the audit log", async () => {
    const { audit, pt, mf } = await fullChain();
    const before = await audit.totalEntries();
    await createProduct(pt, mf);
    expect(await audit.totalEntries()).to.equal(before + 1n);
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 86400;
const Status = { InStock: 0n, InTransit: 1n, Delivered: 2n, Deleted: 3n };
const Kind = { Ship: 0n, Return: 1n, Recall: 2n, Reclaim: 3n };

async function deployAll() {
  const [rootGA, lg, mf, dt, rt, mf2, dt2, rt2, outsider] = await ethers.getSigners();
  const audit = await (await ethers.getContractFactory("AuditLog")).deploy();
  const trust = await (await ethers.getContractFactory("TrustRegistry")).deploy();
  const did   = await (await ethers.getContractFactory("DIDRegistry")).deploy(trust, audit);
  const cred  = await (await ethers.getContractFactory("CredentialRegistry")).deploy(trust, did, audit);
  const lib   = await (await ethers.getContractFactory("Custody")).deploy();
  const pt    = await (await ethers.getContractFactory("ProductTransfer", { libraries: { Custody: await lib.getAddress() } })).deploy(cred, did, audit);
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
      expect(await cred.isLicensedBy(who, issuer)).to.be.true;
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

  it("one live licence per issuer, but several issuers per holder", async () => {
    const { did, cred, mf, dt, mf2, lg } = await fullChain();
    await expect(cred.connect(mf).issueCredential(dt, await expiry()))
      .to.be.revertedWith("CredentialRegistry: you already gave this company an active licence. Revoke it first.");
    await did.connect(mf2).registerDID("Manufacturer", "Beta Mfg");
    await cred.connect(lg).issueCredential(mf2, await expiry());
    await cred.connect(mf2).issueCredential(dt, await expiry());
    expect(await cred.isLicensedBy(dt, mf)).to.be.true;
    expect(await cred.isLicensedBy(dt, mf2)).to.be.true;
    await cred.connect(mf).revokeCredential(await cred.activeCredentialFrom(mf, dt));
    expect(await cred.isLicensedBy(dt, mf)).to.be.false;
    expect(await cred.isLicensedBy(dt, mf2)).to.be.true;
    expect(await cred.isCredentialValid(dt)).to.be.true;          // still valid via Beta Mfg
    expect(await cred.pairState(mf, dt)).to.equal(2n);            // Revoked
    const [all, active] = await cred.getAllCredentials();
    expect(all.length).to.equal(5); expect(active.filter(Boolean).length).to.equal(4);
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
    await expect(pt.connect(dt).createProduct("X", "", 1, "d", "B1")).to.be.revertedWith("ProductTransfer: only Manufacturers can create products");
    await did.connect(mf2).registerDID("Manufacturer", "Beta Mfg");
    await expect(pt.connect(mf2).createProduct("X", "", 1, "d", "B1")).to.be.revertedWith("ProductTransfer: no valid credential");
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

  it("cancel shipment, force recall (MF and DT) with history records", async () => {
    const { pt, ta, mf, dt, rt } = await fullChain();
    const id = await createProduct(pt, mf);
    await pt.connect(mf).shipTo(id, dt);
    await pt.connect(mf).cancelShipment(id);
    expect((await pt.getProduct(id)).status).to.equal(Status.InStock);
    expect((await pt.getTransferHistory(id))[0].cancelled).to.be.true;

    await pt.connect(mf).shipTo(id, dt); await pt.connect(dt).confirmReceipt(id);
    await pt.connect(dt).shipTo(id, rt); await pt.connect(rt).confirmReceipt(id);
    await pt.connect(dt).forceRecall(id);                       // DT pulls back from RT
    expect((await pt.getProduct(id)).currentHolder).to.equal(dt.address);
    expect((await ta.auditProduct(id)).verified).to.be.false;
    await pt.connect(mf).forceRecall(id);                       // MF pulls back from DT
    expect((await pt.getProduct(id)).currentHolder).to.equal(mf.address);
    const h = await pt.getTransferHistory(id);
    expect(h.slice(-2).map(r => r.kind)).to.deep.equal([Kind.Recall, Kind.Recall]);
    expect(h[h.length - 1].note).to.equal("Recalled by Acme Corp");
  });

  it("writes to the audit log", async () => {
    const { audit, pt, mf } = await fullChain();
    const before = await audit.totalEntries();
    await createProduct(pt, mf);
    expect(await audit.totalEntries()).to.equal(before + 1n);
  });
});

describe("v4 — required fields, delete, returns, call-back, multi-manufacturer", () => {
  /** Adds a second Manufacturer (Beta Mfg) that also licenses the same Distributor. */
  async function twoManufacturers() {
    const f = await fullChain();
    const { did, cred, lg, mf2, dt } = f;
    await did.connect(mf2).registerDID("Manufacturer", "Beta Mfg");
    await cred.connect(lg).issueCredential(mf2, await expiry());
    await cred.connect(mf2).issueCredential(dt, await expiry());
    return f;
  }
  const toRetailer = async ({ pt, mf, dt, rt }, id) => {
    await pt.connect(mf).shipTo(id, dt); await pt.connect(dt).confirmReceipt(id);
    await pt.connect(dt).shipTo(id, rt); await pt.connect(rt).confirmReceipt(id);
  };

  it("rejects products with missing / blank required fields", async () => {
    const { pt, mf } = await fullChain();
    const NAME = "ProductTransfer: product name is required (max 80 characters)";
    await expect(pt.connect(mf).createProduct("", "", 1, "d", "B")).to.be.revertedWith(NAME);
    await expect(pt.connect(mf).createProduct(" ", "", 1, "d", "B")).to.be.revertedWith(NAME);
    await expect(pt.connect(mf).createProduct("X".repeat(81), "", 1, "d", "B")).to.be.revertedWith(NAME);
    await expect(pt.connect(mf).createProduct("X", "", 1, "d", "")).to.be.revertedWith("ProductTransfer: batch number is required (max 40 characters)");
    await expect(pt.connect(mf).createProduct("X", "", 1, "", "B")).to.be.revertedWith("ProductTransfer: description is required (max 200 characters)");
    await expect(pt.connect(mf).createProduct("X", "", 0, "d", "B")).to.be.revertedWith("ProductTransfer: quantity must be between 1 and 1,000,000,000");
  });

  it("manufacturer can delete a product created by mistake, but not once it left stock", async () => {
    const { pt, mf, dt } = await fullChain();
    const a = await createProduct(pt, mf, "Oops");
    await expect(pt.connect(dt).deleteProduct(a)).to.be.revertedWith("ProductTransfer: only the manufacturer can delete");
    await pt.connect(mf).shipTo(a, dt); await pt.connect(mf).cancelShipment(a); // a cancelled shipment is fine
    await pt.connect(mf).deleteProduct(a);
    expect((await pt.getProduct(a)).status).to.equal(Status.Deleted);
    await expect(pt.ownerOf(a)).to.be.reverted;

    const b = await createProduct(pt, mf);
    await pt.connect(mf).shipTo(b, dt);
    await expect(pt.connect(mf).deleteProduct(b)).to.be.revertedWith("ProductTransfer: product must be in your stock to delete");
    await pt.connect(dt).confirmReceipt(b);
    await pt.connect(mf).forceRecall(b);
    await expect(pt.connect(mf).deleteProduct(b)).to.be.revertedWith("ProductTransfer: product already left your stock once; it cannot be deleted");
  });

  it("retailer returns to distributor, distributor returns to manufacturer", async () => {
    const f = await fullChain();
    const { pt, ta, mf, dt, rt } = f;
    const id = await createProduct(pt, mf);
    await toRetailer(f, id);
    await expect(pt.connect(rt).returnToSender(id, "")).to.be.revertedWith("ProductTransfer: give a reason for the return (max 200 characters)");
    await pt.connect(rt).returnToSender(id, "Damaged box");
    let p = await pt.getProduct(id);
    expect(p.status).to.equal(Status.InTransit); expect(p.pendingRecipient).to.equal(dt.address);
    await expect(pt.connect(rt).confirmReceipt(id)).to.be.revertedWith("ProductTransfer: not the pending recipient");
    await pt.connect(dt).confirmReceipt(id);
    p = await pt.getProduct(id);
    expect(p.currentHolder).to.equal(dt.address); expect(p.status).to.equal(Status.InStock);
    expect((await ta.auditProduct(id)).verified).to.be.false;

    await pt.connect(dt).returnToSender(id, "Wrong batch");
    expect((await pt.getProduct(id)).pendingRecipient).to.equal(mf.address);
    await pt.connect(mf).confirmReceipt(id);
    expect((await pt.getProduct(id)).currentHolder).to.equal(mf.address);
    const h = await pt.getTransferHistory(id);
    expect(h[h.length - 1].kind).to.equal(Kind.Return);
    expect(h[h.length - 1].note).to.equal("Wrong batch");
    await expect(pt.connect(mf).returnToSender(id, "x")).to.be.revertedWith("ProductTransfer: the manufacturer has no one to return to");
  });

  it("in-transit shipment reverts to the sender when the recipient's licence is revoked", async () => {
    const { pt, cred, mf, dt } = await fullChain();
    const id = await createProduct(pt, mf);
    await pt.connect(mf).shipTo(id, dt);
    let [ok, why] = await pt.reclaimable(id);
    expect(ok).to.be.false; expect(why).to.include("still valid");
    await expect(pt.reclaimProduct(id)).to.be.revertedWith("ProductTransfer: recipient's licence is still valid");

    await cred.connect(mf).revokeCredential(await cred.activeCredentialFrom(mf, dt));
    await expect(pt.connect(dt).confirmReceipt(id)).to.be.revertedWith("ProductTransfer: your licence for this shipment is not active");
    [ok, why] = await pt.reclaimable(id);
    expect(ok).to.be.true; expect(why).to.equal("Shipment reverted to sender: licence of FastShip was revoked");
    await expect(pt.connect(dt).reclaimProduct(id)).to.emit(pt, "ShipmentReverted"); // anyone can trigger
    const p = await pt.getProduct(id);
    expect(p.status).to.equal(Status.InStock); expect(p.currentHolder).to.equal(mf.address);
    const h = await pt.getTransferHistory(id);
    expect(h[0].cancelled).to.be.true; expect(h[0].note).to.equal(why);   // no ghost shipment
  });

  it("expired licence: shipment reverts with an 'expired' note", async () => {
    const { pt, cred, did, mf, dt2 } = await fullChain();
    await did.connect(dt2).registerDID("Distributor", "Short Lived");
    await cred.connect(mf).issueCredential(dt2, (await time.latest()) + 60);
    const id = await createProduct(pt, mf);
    await pt.connect(mf).shipTo(id, dt2);
    await time.increase(120);
    const [, why] = await pt.reclaimable(id);
    expect(why).to.equal("Shipment reverted to sender: licence of Short Lived has expired");
    await pt.reclaimProduct(id);
    expect((await pt.getProduct(id)).status).to.equal(Status.InStock);
  });

  it("held product is called back upstream when the holder's licence lapses", async () => {
    const f = await fullChain();
    const { pt, cred, mf, dt, rt } = f;
    const id = await createProduct(pt, mf);
    await toRetailer(f, id);
    await cred.connect(dt).revokeCredential(await cred.activeCredentialFrom(dt, rt));
    const [ok, why] = await pt.reclaimable(id);
    expect(ok).to.be.true; expect(why).to.equal("Called back to FastShip: licence of CornerShop was revoked");
    await pt.reclaimProduct(id);
    expect((await pt.getProduct(id)).currentHolder).to.equal(dt.address);
    const h = await pt.getTransferHistory(id);
    expect(h[h.length - 1].kind).to.equal(Kind.Reclaim);
  });

  it("manufacturer's stock is frozen, not destroyed, when its licence lapses", async () => {
    const { pt, cred, lg, mf } = await fullChain();
    const id = await createProduct(pt, mf);
    await cred.connect(lg).revokeCredential(await cred.activeCredentialOf(mf));
    await expect(pt.reclaimProduct(id)).to.be.revertedWith(
      "ProductTransfer: the manufacturer's licence is not valid; its stock stays frozen until the licence is restored");
    expect(await pt.ownerOf(id)).to.equal(mf.address);
    expect((await pt.getProduct(id)).status).to.equal(Status.InStock);
  });

  it("distributor with two manufacturers: licences are separate per manufacturer", async () => {
    const f = await twoManufacturers();
    const { pt, cred, mf, mf2, dt, rt } = f;
    const a = await createProduct(pt, mf, "Acme thing");
    const b = await createProduct(pt, mf2, "Beta thing");
    await pt.connect(mf).shipTo(a, dt); await pt.connect(dt).confirmReceipt(a);
    await pt.connect(mf2).shipTo(b, dt); await pt.connect(dt).confirmReceipt(b);

    await cred.connect(mf).revokeCredential(await cred.activeCredentialFrom(mf, dt)); // Acme drops FastShip
    await expect(pt.connect(dt).shipTo(a, rt)).to.be.revertedWith("ProductTransfer: your licence from this product's Manufacturer is not active");
    await pt.connect(dt).shipTo(b, rt);                                              // Beta's product still moves
    expect((await pt.reclaimable(a))[1]).to.equal("Called back to Acme Corp: licence of FastShip was revoked");
    expect((await pt.reclaimable(b))[0]).to.be.false;
    await pt.reclaimProduct(a);
    expect((await pt.getProduct(a)).currentHolder).to.equal(mf.address);
  });

  it("audit checks licences at handoff time and reports today's status separately", async () => {
    const f = await fullChain();
    const { pt, ta, cred, dt, rt, mf } = f;
    const id = await createProduct(pt, mf);
    await toRetailer(f, id);
    let r = await ta.auditProduct(id);
    expect(r.verified).to.be.true; expect(r.currentlyValid).to.be.true;

    await cred.connect(dt).revokeCredential(await cred.activeCredentialFrom(dt, rt)); // revoked AFTER delivery
    r = await ta.auditProduct(id);
    expect(r.verified, r.failReason).to.be.true;
    expect(r.currentlyValid).to.be.false;
    expect(r.currentNote).to.equal("Retailer's licence from the distributor is no longer valid");
  });

  it("getLastRecords / shipperTo helpers", async () => {
    const f = await fullChain();
    const { pt, mf, dt, rt } = f;
    const a = await createProduct(pt, mf);
    const b = await createProduct(pt, mf);
    await toRetailer(f, a);
    const [ra, rb] = await pt.getLastRecords([a, b]);
    expect(ra.to).to.equal(rt.address); expect(rb.from).to.equal(ethers.ZeroAddress);
    expect(await pt.shipperTo(a, rt)).to.equal(dt.address);
  });
});

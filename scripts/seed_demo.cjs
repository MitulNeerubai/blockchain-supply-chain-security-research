// scripts/seed_demo.cjs — fills a LOCAL chain with a demo scenario for screenshots / the paper.
//
//   npx hardhat node                                   (terminal 1)
//   npm run deploy:local                               (terminal 2)
//   npx hardhat run scripts/seed_demo.cjs --network localhost
//
// Never run this against Besu: it uses Hardhat's built-in test accounts.

const hre = require("hardhat");
const { ethers } = hre;
const dep = require("../src/deployment.json");

async function main() {
  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") throw new Error("seed_demo is for local chains only");
  const [root, lg, acme, beta, fast, slow, shop, mart] = await ethers.getSigners();
  const C = (k, s) => new ethers.Contract(dep.contracts[k].address, dep.contracts[k].abi, s);
  const send = async p => (await p).wait();
  const year = async () => (await ethers.provider.getBlock("latest")).timestamp + 365 * 86400;

  for (const [s, role, name] of [[lg, "LocalGovt", "City of Kansas"], [acme, "Manufacturer", "Acme Corp"], [beta, "Manufacturer", "Beta Foods"],
    [fast, "Distributor", "FastShip Logistics"], [slow, "Distributor", "SlowFreight"], [shop, "Retailer", "CornerShop"], [mart, "Retailer", "MegaMart"]]) {
    await send(C("did", s).registerDID(role, name));
  }
  await send(C("trust", root).authorizeIssuer(lg.address, "LocalGovt"));
  await send(C("cred", lg).issueCredential(acme.address, await year()));
  await send(C("cred", lg).issueCredential(beta.address, await year()));
  await send(C("cred", acme).issueCredential(fast.address, await year()));
  await send(C("cred", beta).issueCredential(fast.address, await year()));   // FastShip works for two manufacturers
  await send(C("cred", acme).issueCredential(slow.address, await year()));
  await send(C("cred", fast).issueCredential(shop.address, await year()));
  // MegaMart registered but not licensed yet

  const pt = s => C("pt", s);
  const create = async (s, name, qty, desc, batch) => {
    const rc = await send(pt(s).createProduct(name, "", qty, desc, batch));
    return rc.logs.map(l => { try { return pt(s).interface.parseLog(l); } catch { return null; } }).find(e => e?.name === "ProductCreated").args.id;
  };
  const p1 = await create(acme, "Smart Thermostat T1", 50, "Wi-Fi thermostat, 230 V", "ACME-2026-001");
  const p2 = await create(acme, "LED Panel 60x60", 120, "Ceiling panel, 40 W, 4000 K", "ACME-2026-002");
  const p3 = await create(beta, "Organic Oat Milk 1L", 400, "Shelf-stable oat drink, 12 cartons per case", "BETA-OAT-17");
  const p4 = await create(acme, "Cordless Drill D20", 30, "20 V drill with two batteries", "ACME-2026-003");
  const p5 = await create(acme, "Test product (typo)", 1, "Created by mistake", "TMP-1");
  await create(acme, "Smart Plug P2", 200, "16 A smart plug with energy meter", "ACME-2026-004");

  // p1: full chain, verified
  await send(pt(acme).shipTo(p1, fast.address)); await send(pt(fast).confirmReceipt(p1));
  await send(pt(fast).shipTo(p1, shop.address)); await send(pt(shop).confirmReceipt(p1));
  // p2: delivered, then returned by the retailer (awaiting FastShip)
  await send(pt(acme).shipTo(p2, fast.address)); await send(pt(fast).confirmReceipt(p2));
  await send(pt(fast).shipTo(p2, shop.address)); await send(pt(shop).confirmReceipt(p2));
  await send(pt(shop).returnToSender(p2, "Damaged in transit"));
  // p3: Beta product at FastShip
  await send(pt(beta).shipTo(p3, fast.address)); await send(pt(fast).confirmReceipt(p3));
  // p4: shipped to SlowFreight, then Acme revokes SlowFreight's licence → shipment can be called back
  await send(pt(acme).shipTo(p4, slow.address));
  const cred = C("cred", acme);
  await send(cred.revokeCredential(await cred.activeCredentialFrom(acme.address, slow.address)));
  // p5: created by mistake, deleted
  await send(pt(acme).deleteProduct(p5));

  console.log("Seeded. Accounts (Hardhat test keys):");
  for (const [n, s] of Object.entries({ root, lg, acme, beta, fast, slow, shop, mart })) console.log(`  ${n.padEnd(5)} ${s.address}`);
}

main().catch(e => { console.error(e); process.exit(1); });

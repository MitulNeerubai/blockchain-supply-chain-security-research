# DIDLab Supply Chain — SSI Traceability Prototype

A Self-Sovereign Identity (SSI) supply-chain traceability system on Hyperledger Besu. Companies hold an on-chain DID with a unique company name, receive licences down a chain of trust, and move products (ERC-721 tokens) only to partners they licensed. Anyone can verify a product's chain of custody by scanning its QR code.

> Research prototype — **DIDLab, Digital Identity and Distributed Ledger Laboratory, UMKC**
> Supervisor: Dr. A S M Touhidul Hasan · Live: https://mitul.didlab.org

---

## Chain of trust

```
rootGA (deployer)
  └─ grants LG licence ─────────────▶ Local Government
                                         └─ Manufacturing License ─▶ Manufacturer
                                                                       └─ Trade License ─▶ Distributor
                                                                                            └─ Trade License ─▶ Retailer
```

| Role | Registers as | Licensed by | Can license | Products |
|---|---|---|---|---|
| **rootGA** | — (deployer wallet) | — | Local Governments | — |
| **Local Government** | `LocalGovt` | rootGA | Manufacturers | — |
| **Manufacturer** | `Manufacturer` | Local Government | Distributors | create, ship to *its* Distributors, recall |
| **Distributor** | `Distributor` | Manufacturer | Retailers | accept, ship to *its* Retailers, recall from them |
| **Retailer** | `Retailer` | Distributor | — | accept, verify chain, share QR |

Rules enforced **on-chain**:

- **Unique company names** — stored in the DID, case-insensitive (`Acme` = `ACME`).
- **Role-locked licensing** — each role can only license the next role down; the licence type follows from the holder's role.
- **One live licence per wallet** — a new licence supersedes the old one.
- **Cascading revocation** — a licence is only valid while its issuer is still trusted. Revoking an LG suspends its Manufacturers, their Distributors and their Retailers; re-granting restores them.
- **Licensed handoffs** — `shipTo` only accepts a recipient whose live licence *you* issued. Every handoff is two-step (ship → recipient confirms).
- **No side-door transfers** — direct ERC-721 `transferFrom` is blocked.

## Contracts (`contracts/`)

| Contract | Purpose |
|---|---|
| `TrustRegistry` | rootGA grants / revokes LG licences |
| `DIDRegistry` | `registerDID(role, companyName)`, unique names, full directory (`getAllDIDs`) |
| `CredentialRegistry` | `issueCredential(holder, expiresAt)`, revoke, cascading validity, `licensedBy(holder)` |
| `ProductTransfer` | ERC-721 products: create, ship, confirm, cancel, force-recall, reclaim |
| `TraceabilityAudit` | Read-only MF → DT → RT chain verification |
| `AuditLog` | Append-only on-chain log written by the other contracts |

## Project layout

```
contracts/            Solidity sources
test/                 Hardhat tests (npm test)
deploy_all.cjs        Deploys all 6 contracts, writes src/deployment.json (addresses + ABIs)
src/                  React app (Vite)
  lib/                chain access, formatting, email API, React contexts
  components/         UI kit, licence panel, product list, timeline, QR
  pages/              Connect, Register, RootGA, LocalGovt, Manufacturer, Distributor, Retailer, Verify
server.js             Email-OTP API (/api/*) + static server for dist/
notifier.js           Emails participants on chain events
```

## Setup

> **Step-by-step deployment guide: [DEPLOY.md](DEPLOY.md)**

```bash
npm install
cp .env.example .env      # set PRIVATE_KEY_ROOTGA, GMAIL_USER, GMAIL_PASS
npm test                  # contract tests
```

MetaMask network: name `besu`, RPC `https://eth.didlab.org`, chain ID `252501`, currency `TRUST` (the app offers to add it automatically).

## Deploy (every time a contract changes)

```bash
npm run deploy:besu       # deploys all 6 contracts; deployer = rootGA; writes src/deployment.json
npm run build             # builds the UI with the new addresses into dist/
```

Then publish `dist/` to the web root, e.g. on the server:

```bash
rm -f /srv/www/assets/index-*.js /srv/www/assets/index-*.css
cp dist/index.html /srv/www/index.html
cp dist/assets/* /srv/www/assets/
```

There is nothing to paste into `App.jsx` any more — addresses and ABIs come from `src/deployment.json`.
A redeploy starts from an empty chain state: everyone registers again and licences are re-issued.

## Local development

```bash
npm run node:local        # terminal 1 — local chain (chain ID 1337)
npm run deploy:local      # terminal 2
npm run dev               # terminal 3 — http://localhost:5173
npm run server            # optional — email OTP API on :3001
```

## Email notifications

`server.js` verifies a 6-digit code sent to the email **and** a MetaMask signature from the wallet, then stores `{ wallet → email }` in `emails.json`. `notifier.js` (`npm run notifier`) emails the right company when a shipment is sent, received, cancelled, recalled or reclaimed, and when licences are issued or revoked.

## Research context

Implements the **Trusted Traceability Service (TTS)** framework from:

> Hasan, A. S. M. T., et al. *"Trusted Traceability Service: A Novel Approach to Securing Supply Chains."* Electronics, MDPI, 2025.

## Author

**Mitul Neerubai** — B.S. Computer Science, UMKC · Research Analyst, DIDLab
[github.com/MitulNeerubai](https://github.com/MitulNeerubai) · [linkedin.com/in/mitul-neerubai](https://linkedin.com/in/mitul-neerubai)

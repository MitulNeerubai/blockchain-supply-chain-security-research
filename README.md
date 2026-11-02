# Blockchain Supply Chain Security - SSI Prototype

A Self-Sovereign Identity (SSI) based supply chain traceability system built on Hyperledger Besu. Implements the Trusted Traceability Service (TTS) framework with a full React UI, on-chain credential enforcement, and an immutable audit trail.

> Research prototype developed at **DIDLab — Digital Identity and Distributed Ledger Laboratory, UMKC**  
> Supervisor: Dr. A S M Touhidul Hasan

---

## Overview

This system allows a multi-actor supply chain (Root Governance Authority → Local Government → Manufacturer → Distributor → Retailer) to track products end-to-end on a permissioned blockchain. Every transfer is enforced by smart contracts - only credentialed, DID-registered actors can participate.

---

## Architecture

### Actors
| Role | Responsibility |
|------|---------------|
| **RootGA** | Authorizes Local Governments as trusted credential issuers |
| **Local Government** | Issues Manufacturing Licenses and Trade Licenses |
| **Manufacturer** | Creates products, ships to Distributors |
| **Distributor** | Claims custody, forwards to Retailers |
| **Retailer** | Claims final custody, verifies full chain |

### Smart Contracts
| Contract | Address | Purpose |
|----------|---------|---------|
| `TrustRegistry` | `0x2e4511...` | Root of trust — authorized issuers |
| `DIDRegistry` | `0x98F494...` | Decentralized Identifiers for all actors |
| `CredentialRegistry` | `0x841fa7...` | On-chain verifiable credentials |
| `ProductTransfer` | `0x4c4c26...` | Product creation, custody transfers, secret-hash claim |
| `AuditLog` | `0x4EE60A...` | Immutable event log for all actions |

### Network
- **Chain:** Hyperledger Besu (QBFT)
- **Chain ID:** 252501
- **RPC:** `https://eth.didlab.org`
- **Explorer:** `https://explorer.didlab.org`

---

## Key Features

- **SSI-based access control** - actors register DIDs and hold verifiable credentials before they can participate
- **Commit-reveal transfers** - products are shipped with a secret hash; recipient claims by revealing the plaintext secret
- **Full audit trail** - every action (authorize, register, issue, create, ship, claim) is logged on-chain with timestamps
- **Chain verification** - Retailer can verify the entire custody chain: roles, credentials, transfer sequence, and DID status at every hop
- **Smart contract enforcement** - unauthorized actors are blocked at the contract level, not just the UI

---

## Tech Stack

- **Solidity 0.8.24** - smart contracts
- **Hardhat v2.22.15** - development and deployment
- **Ethers.js v6** - blockchain interaction
- **React** - frontend UI
- **MetaMask** - wallet integration
- **Hyperledger Besu** - permissioned EVM network

---

## Getting Started

### Prerequisites
- Node.js v18+
- MetaMask browser extension
- Add DIDLab network to MetaMask:
  - Network name: DIDLab
  - RPC URL: `https://eth.didlab.org`
  - Chain ID: `252501`
  - Currency: `TRUST`

### Install & Run
```bash
git clone https://github.com/MitulNeerubai/blockchain-supply-chain-security-research.git
cd blockchain-supply-chain-security-research
npm install
npm run dev
```

### Deploy Contracts
```bash
cd contracts
npx hardhat run scripts/deploy.js --network didlab
```

---

## How It Works

### 1. Setup (RootGA)
RootGA authorizes a Local Government wallet as a trusted credential issuer via `TrustRegistry.authorizeIssuer()`.

### 2. Registration
Each actor registers a DID with their role via `DIDRegistry.registerDID()`.

### 3. Credentialing (Local Government)
LG issues a `ManufacturingLicense` to the Manufacturer and `TradeLicense` to Distributors and Retailers via `CredentialRegistry.issueCredential()`.

### 4. Product Creation (Manufacturer)
MF calls `ProductTransfer.createProduct()`. Contract checks:
- Caller has a valid `ManufacturingLicense`
- Caller's DID is active

### 5. Transfer (Commit-Reveal)
MF calls `commitTransfer(productId, recipientAddress, secretHash)`. Contract checks:
- Recipient has a valid `TradeLicense`
- Recipient's DID is active

Recipient calls `claimTransfer(productId, plainTextSecret)` to take custody.

### 6. Chain Verification (Retailer)
`TraceabilityAudit.auditProduct()` verifies the entire history:
- Confirmed transfers exist (MF→DT, DT→RT)
- Each holder had valid credentials
- All DIDs were active
- Roles match expected sequence

---

## Research Context

This prototype implements the **Trusted Traceability Service (TTS)** framework proposed in:

> Hasan, A. S. M. T., et al. *"Trusted Traceability Service: A Novel Approach to Securing Supply Chains."* Electronics, MDPI, 2025.

The original paper demonstrated the TTS architecture on the Fantom public blockchain as a simulation. This project is the **first real-world prototype implementation** of the TTS framework on a permissioned Hyperledger Besu network, with a complete React UI and MetaMask integration.

---

## Author

**Mitul Neerubai**  
B.S. Computer Science, UMKC (May 2026)  
Research Analyst - DIDLab, UMKC  
[github.com/MitulNeerubai](https://github.com/MitulNeerubai) · [linkedin.com/in/mitul-neerubai](https://linkedin.com/in/mitul-neerubai)

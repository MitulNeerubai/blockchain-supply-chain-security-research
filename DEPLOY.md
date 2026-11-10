# How to deploy and run

A step-by-step guide to running this project on your own machine. Steps 1–3 are enough to **use the existing deployment** on DIDLab Besu. Steps 4–5 are only for deploying **your own** copy of the contracts.

---

## 0. Prerequisites

- **Node.js 18 or newer** (`node -v` to check), which includes npm
- **Git**
- **MetaMask** browser extension
- A **Gmail account** with an **App Password**, needed for email verification codes:
  Google Account → Security → 2-Step Verification → App passwords

## 1. Clone and install

```bash
git clone https://github.com/MitulNeerubai/blockchain-supply-chain-security-research.git
cd blockchain-supply-chain-security-research
npm install
```

## 2. Create your `.env`

```bash
# Windows PowerShell
copy .env.example .env
# macOS / Linux
cp .env.example .env
```

Open `.env` (`notepad .env` on Windows) and replace the `PASTE_…` values:

| Variable | What to paste | Needed for |
|---|---|---|
| `PRIVATE_KEY_ROOTGA` | Private key of the wallet that will deploy and become **rootGA** | Step 4 (deploying) only |
| `GMAIL_USER` | Your Gmail address | Email codes and notifications |
| `GMAIL_PASS` | Your 16-character Gmail **App Password** | Email codes and notifications |

> ⚠️ `.env` is git-ignored. **Never commit or share it.** It holds your private key.

`emails.json` is created automatically by the email server when companies verify their email. You don't need to create it. `emails.example.json` only shows the format.

## 3. Run the app

Open **two terminals** in the project folder:

```bash
# Terminal 1 — email verification service (port 3001)
npm run server

# Terminal 2 — the web app (port 5173)
npm run dev
```

Open **http://localhost:5173** in the browser where MetaMask is installed. The app offers to add the network to MetaMask; otherwise add it manually:

| Field | Value |
|---|---|
| Network name | `besu` |
| RPC URL | `https://eth.didlab.org` |
| Chain ID | `252501` |
| Currency symbol | `TRUST` |

Optional: `npm run notifier` in a third terminal sends email alerts for shipments, licences and recalls.

The repo ships with `src/deployment.json` pointing at the **already-deployed** contracts, so the app works straight away. In that deployment, rootGA is the original deployer's wallet. To be rootGA yourself, deploy your own copy (step 4).

## 4. Deploy your own contracts (optional)

Required whenever a contract in `contracts/` changes, or if you want your own rootGA.

```bash
npm test                 # all tests should pass
npm run deploy:besu      # deploys all 6 contracts; your PRIVATE_KEY_ROOTGA wallet = rootGA
```

The deploy script:
- prints each contract address;
- writes the addresses and ABIs to `src/deployment.json` (the app reads this file, so there's nothing to edit by hand);
- writes a copy to `deployments/besu.json`.

Then restart `npm run dev`. A new deployment starts with an **empty chain state**: every company registers again and licences are re-issued.

## 5. Build for a web server (optional)

```bash
npm run build            # outputs the static site to dist/
```

Either:
- copy the contents of `dist/` to any static web host (nginx, Apache, Netlify, Vercel, GitHub Pages…). Proxy `/api/*` to `server.js` for email codes; or
- run `npm run server`, which also serves `dist/`, then open http://localhost:3001.

## 6. First-time setup in the app

Each role needs its own MetaMask account with a little TRUST for gas.

1. Each company **registers**: role, unique company name, email code.
2. **rootGA** → *Local Governments* → **Grant LG licence**.
3. **Local Government** → *Manufacturers* → issue a Manufacturing License.
4. **Manufacturer** → *Distributors* → issue a Trade License → *Products* → create and **Ship**.
5. **Distributor** → *Incoming* → **Accept** → *Retailers* → issue a Trade License → **Ship**.
6. **Retailer** → *Incoming* → **Accept** → **Verify chain** → **QR**.
7. Anyone can open the QR link to verify the product, with no wallet needed.

## Local blockchain instead of Besu (for development)

```bash
npm run node:local       # terminal 1 — local chain, chain ID 1337, with funded test accounts
npm run deploy:local     # terminal 2 — deploys and points the app at the local chain
npm run dev              # terminal 3
```

Import one of the private keys printed by `node:local` into MetaMask. Run `npm run deploy:besu` again afterwards to point the app back at Besu.

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE :3001` or `:5173` | Something is already using the port. Close the other terminal or stop that process. |
| "No deployer account" when deploying | `PRIVATE_KEY_ROOTGA` in `.env` is missing or still the placeholder |
| "Email sending is not configured" | Set `GMAIL_USER` / `GMAIL_PASS` in `.env` and restart `npm run server` |
| "The notification service is unreachable" | `npm run server` isn't running |
| MetaMask is on the wrong network | Switch to `besu` (chain ID 252501) |
| "Not enough TRUST" | Send TRUST to that wallet for gas |

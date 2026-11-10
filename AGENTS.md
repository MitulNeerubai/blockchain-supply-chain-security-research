# Agent notes — DIDLab Supply Chain

Hardhat **2** + ethers v6 (not Hardhat 3 / viem). React 19 + Vite frontend at the repo root.

- Contracts: `contracts/*.sol` — Solidity 0.8.24, OpenZeppelin 5, `evmVersion: london`.
- Tests: `npm test` (`test/trustchain.test.cjs`, mocha + chai matchers).
- Deploy: `npm run deploy:besu` (network name `besu`, chain 252501). Deployer = rootGA.
  `deploy_all.cjs` writes `src/deployment.json` (addresses + ABIs); the UI imports it. Rebuild with `npm run build`.
- Any contract change requires a redeploy + rebuild; never hand-edit addresses in the UI.
- Frontend reads go through `src/lib/chain.js` (`reader()`), writes through `useSession().write` and `useTx()`.
- Company names / roles come from `DIDRegistry.getAllDIDs()` via `useDirectory()` — never from localStorage.
- `server.js` = email OTP API + static server for `dist/`; `notifier.js` = event emails. Emails keyed by wallet in `emails.json`.

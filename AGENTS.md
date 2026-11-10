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
- `notifier.js` also runs an optional keeper (`KEEPER_PRIVATE_KEY`) that calls `reclaimProduct` on in-transit shipments whose recipient's licence lapsed.
- UI uses hash routes: `#/` overview, `#/products`, `#/product/<id>`, `#/companies`, `#/guide`, `#/verify` are public (no wallet); `#/app` is the MetaMask dashboard. Old `?verify=<id>` QR links still work.
- Licences are per relationship: a holder has at most one live licence per issuer (`isLicensedBy(holder, issuer)`); a Distributor may hold licences from several Manufacturers.
- Onboarding text lives in `src/lib/guide.js` (welcome pop-up, dashboard sidebar, Guide page).
- Local demo: `npx hardhat node`, `npm run deploy:local`, `npm run seed:local` (overwrites src/deployment.json — restore the Besu one before building for production).

import { ethers } from 'ethers'
import deployment from '../deployment.json'
import { ZERO, nowSec } from './format'

export const DEPLOYMENT = deployment
export const CHAIN_ID = deployment.chainId
export const RPC_URL = deployment.rpcUrl
export const IS_BESU = CHAIN_ID === 252501
export const CHAIN_NAME = IS_BESU ? 'DIDLab Besu' : `Local chain ${CHAIN_ID}`
export const EXPLORER = IS_BESU ? 'https://explorer.didlab.org' : null

const C = deployment.contracts

/** Contract instances bound to a runner (signer for writes, provider for reads). */
export function getContracts(runner) {
  const out = {}
  for (const [k, v] of Object.entries(C)) out[k] = new ethers.Contract(v.address, v.abi, runner)
  return out
}

let _read
export function readProvider() {
  // cacheTimeout -1: never serve a cached read right after a transaction
  if (!_read) _read = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true, cacheTimeout: -1 })
  return _read
}
export const reader = () => getContracts(readProvider())

// ── Wallet ──────────────────────────────────────────────────────────────────
export const hasWallet = () => typeof window !== 'undefined' && !!window.ethereum

async function ensureChain() {
  const hex = '0x' + CHAIN_ID.toString(16)
  const current = parseInt(await window.ethereum.request({ method: 'eth_chainId' }), 16)
  if (current === CHAIN_ID) return
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
  } catch (e) {
    if (e?.code === 4902 || /unrecognized chain/i.test(e?.message || '')) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hex,
          chainName: IS_BESU ? 'besu' : CHAIN_NAME,
          rpcUrls: [RPC_URL],
          nativeCurrency: { name: 'TRUST', symbol: 'TRUST', decimals: 18 },
          ...(EXPLORER ? { blockExplorerUrls: [EXPLORER] } : {}),
        }],
      })
    } else if (e?.code === 4001) {
      throw new Error(`Please switch MetaMask to ${CHAIN_NAME} to continue.`)
    } else throw e
  }
}

/** Ask MetaMask for an account; `silent` only reuses an existing permission. */
export async function connectWallet({ silent = false } = {}) {
  if (!hasWallet()) throw new Error('MetaMask was not found. Install the MetaMask extension to continue.')
  const accounts = await window.ethereum.request({ method: silent ? 'eth_accounts' : 'eth_requestAccounts' })
  if (!accounts?.length) return null
  await ensureChain()
  const provider = new ethers.BrowserProvider(window.ethereum, 'any')
  const signer = await provider.getSigner()
  return { signer, address: await signer.getAddress() }
}

// ── Loaders ─────────────────────────────────────────────────────────────────
export async function loadDirectory() {
  const { did } = reader()
  const docs = await did.getAllDIDs()
  const map = new Map()
  for (const d of docs) {
    map.set(d.controller.toLowerCase(), {
      address: d.controller,
      did: d.did,
      role: d.role,
      company: d.companyName,
      createdAt: Number(d.createdAt),
      active: d.active,
    })
  }
  return map
}

export async function loadIdentity(address) {
  const { trust, did } = reader()
  const [rootGA, doc] = await Promise.all([trust.rootGA(), did.getDID(address)])
  const isRootGA = rootGA.toLowerCase() === address.toLowerCase()
  const registered = doc.did.length > 0
  return {
    rootGA,
    isRootGA,
    registered,
    role: isRootGA ? 'RootGA' : registered ? doc.role : null,
    company: isRootGA ? 'Root Governance Authority' : doc.companyName,
    did: doc.did,
    active: doc.active,
    createdAt: Number(doc.createdAt),
  }
}

const CRED_STATE = ['none', 'active', 'revoked', 'expired', 'suspended']
export const credStateName = n => CRED_STATE[Number(n)] || 'none'

function credStatus(c, active) {
  if (c.revoked) return 'revoked'
  if (Number(c.expiresAt) < nowSec()) return 'expired'
  return active ? 'active' : 'suspended'
}

function normCred(c, active) {
  return {
    id: c.id,
    issuer: c.issuer,
    holder: c.holder,
    type: c.credType,
    issuedAt: Number(c.issuedAt),
    expiresAt: Number(c.expiresAt),
    revoked: c.revoked,
    revokedAt: Number(c.revokedAt),
    active,
    status: credStatus(c, active),
  }
}

export async function loadCredentials(ids) {
  const { cred } = reader()
  const unique = [...new Set(ids.map(String))]
  const rows = await Promise.all(unique.map(async id => {
    const [c, active] = await Promise.all([cred.getCredential(id), cred.isCredentialActive(id)])
    return normCred(c, active)
  }))
  return rows.sort((a, b) => b.issuedAt - a.issuedAt)
}

/** Keep only the newest credential per issuer→holder pair (the one that decides the relationship). */
export function latestPerPair(creds) {
  const m = new Map()
  for (const c of [...creds].sort((a, b) => b.issuedAt - a.issuedAt)) {
    const k = c.issuer.toLowerCase() + '>' + c.holder.toLowerCase()
    const cur = m.get(k)
    if (!cur || (c.active && !cur.active)) m.set(k, c)
  }
  return [...m.values()]
}

/** All licences this wallet holds — one per issuer (newest / live one). */
export async function loadMyLicences(address) {
  const { cred } = reader()
  const ids = await cred.getCredentialsByHolder(address)
  if (!ids.length) return []
  return latestPerPair(await loadCredentials(ids))
}

export async function loadIssuedBy(address) {
  const { cred } = reader()
  return loadCredentials(await cred.getCredentialsByIssuer(address))
}

/** Public: every credential + LG authorisations — the whole trust network in 3 calls. */
export async function loadNetwork() {
  const { cred, trust } = reader()
  const [[list, active], rootGA, issuers] = await Promise.all([cred.getAllCredentials(), trust.rootGA(), trust.getIssuers()])
  const auth = await Promise.all(issuers.map(a => Promise.all([trust.isAuthorizedIssuer(a), trust.authorizedAt(a)])))
  return {
    rootGA,
    creds: list.map((c, i) => normCred(c, active[i])),
    lg: Object.fromEntries(issuers.map((a, i) => [a.toLowerCase(), { authorized: auth[i][0], since: Number(auth[i][1]) }])),
  }
}

function normRecord(r) {
  return {
    from: r.from, to: r.to, timestamp: Number(r.timestamp),
    confirmed: r.confirmed, cancelled: r.cancelled, kind: Number(r.kind), note: r.note,
  }
}

function normProduct(p, last) {
  return {
    id: p.id.toString(),
    name: p.name,
    ipfsCID: p.ipfsCID,
    manufacturer: p.manufacturer,
    holder: p.currentHolder,
    pending: p.pendingRecipient === ZERO ? null : p.pendingRecipient,
    status: Number(p.status),
    createdAt: Number(p.createdAt),
    quantity: p.quantity.toString(),
    description: p.description,
    batchNumber: p.batchNumber,
    last: last && Number(last.timestamp) > 0 ? normRecord(last) : null,
  }
}

const CHUNK = 150
export async function loadProducts(ids) {
  const unique = [...new Set(ids.map(i => i.toString()))]
  if (!unique.length) return []
  const { pt } = reader()
  const out = []
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK)
    const [rows, lasts] = await Promise.all([pt.getProducts(part), pt.getLastRecords(part)])
    rows.forEach((p, j) => { if (p.id !== 0n) out.push(normProduct(p, lasts[j])) })
  }
  return out.sort((a, b) => Number(b.id) - Number(a.id))
}

/** Public: every product on the chain (no wallet). */
export async function loadAllProducts() {
  const total = Number(await reader().pt.totalProducts())
  return loadProducts(Array.from({ length: total }, (_, i) => i + 1))
}

export async function loadProduct(id) {
  const { pt } = reader()
  const [p, h] = await Promise.all([pt.getProduct(id), pt.getTransferHistory(id)])
  const history = h.map(normRecord)
  return { ...normProduct(p, h[h.length - 1]), history }
}

/** For each product: can it be called back right now, and why. */
export async function loadReclaimable(products) {
  const { pt } = reader()
  const rows = await Promise.all(products.map(p => pt.reclaimable(p.id).then(([ok, reason]) => [p.id, { ok, reason }]).catch(() => [p.id, { ok: false, reason: '' }])))
  return Object.fromEntries(rows)
}

export async function loadAudit(id) {
  const { ta } = reader()
  const r = await ta.auditProduct(id)
  return {
    verified: r.verified,
    currentlyValid: r.currentlyValid,
    currentNote: r.currentNote,
    failReason: r.failReason,
    productName: r.productName,
    manufacturer: r.manufacturer,
    distributor: r.distributor,
    retailer: r.retailer,
    manufacturedAt: Number(r.manufacturedAt),
    shippedToDistributor: Number(r.shippedToDistributor),
    shippedToRetailer: Number(r.shippedToRetailer),
  }
}

export async function loadAuditLog(limit = 50) {
  const { audit } = reader()
  const total = Number(await audit.totalEntries())
  if (!total) return []
  const from = Math.max(0, total - limit)
  const rows = await audit.getEntries(from, total)
  return rows.map((e, i) => ({
    index: from + i,
    timestamp: Number(e.timestamp),
    actor: e.actor,
    action: e.action,
    details: e.details,
  })).reverse()
}

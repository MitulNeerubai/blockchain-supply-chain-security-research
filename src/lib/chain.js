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

function credStatus(c, active) {
  if (c.revoked) return 'revoked'
  if (Number(c.expiresAt) < nowSec()) return 'expired'
  return active ? 'active' : 'suspended'
}

export async function loadCredentials(ids) {
  const { cred } = reader()
  const unique = [...new Set(ids.map(String))]
  const rows = await Promise.all(unique.map(async id => {
    const [c, active] = await Promise.all([cred.getCredential(id), cred.isCredentialActive(id)])
    return {
      id,
      issuer: c.issuer,
      holder: c.holder,
      type: c.credType,
      issuedAt: Number(c.issuedAt),
      expiresAt: Number(c.expiresAt),
      revoked: c.revoked,
      active,
      status: credStatus(c, active),
    }
  }))
  return rows.sort((a, b) => b.issuedAt - a.issuedAt)
}

/** The wallet's licence: the live one if any, otherwise the most recent. */
export async function loadMyLicence(address) {
  const { cred } = reader()
  const [ids, activeId] = await Promise.all([cred.getCredentialsByHolder(address), cred.activeCredentialOf(address)])
  if (!ids.length) return null
  const all = await loadCredentials(ids)
  return all.find(c => c.id === activeId) || all[0]
}

export async function loadIssuedBy(address) {
  const { cred } = reader()
  return loadCredentials(await cred.getCredentialsByIssuer(address))
}

function normProduct(p) {
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
  }
}

export async function loadProducts(ids) {
  const unique = [...new Set(ids.map(i => i.toString()))]
  if (!unique.length) return []
  const { pt } = reader()
  const rows = await pt.getProducts(unique)
  return rows.filter(p => p.id !== 0n).map(normProduct).sort((a, b) => Number(b.id) - Number(a.id))
}

export async function loadProduct(id) {
  const { pt } = reader()
  const [p, h] = await Promise.all([pt.getProduct(id), pt.getTransferHistory(id)])
  return {
    ...normProduct(p),
    history: h.map(r => ({ from: r.from, to: r.to, timestamp: Number(r.timestamp), confirmed: r.confirmed, cancelled: r.cancelled })),
  }
}

export async function loadAudit(id) {
  const { ta } = reader()
  const r = await ta.auditProduct(id)
  return {
    verified: r.verified,
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

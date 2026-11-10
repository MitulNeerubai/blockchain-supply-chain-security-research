import { ethers } from 'ethers'

export const ZERO = ethers.ZeroAddress
export const DAY = 86400

export const short = a => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
export const isZero = a => !a || a === ZERO

export const fmtDate = ts =>
  ts ? new Date(Number(ts) * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
export const fmtDateTime = ts =>
  ts ? new Date(Number(ts) * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export const nowSec = () => Math.floor(Date.now() / 1000)
export const daysLeft = ts => Math.ceil((Number(ts) - nowSec()) / DAY)

export const ROLES = ['LocalGovt', 'Manufacturer', 'Distributor', 'Retailer']
export const ROLE_LABEL = {
  RootGA: 'Root Governance Authority',
  LocalGovt: 'Local Government',
  Manufacturer: 'Manufacturer',
  Distributor: 'Distributor',
  Retailer: 'Retailer',
}
export const ROLE_ICON = { RootGA: '🏛️', LocalGovt: '🏢', Manufacturer: '🏭', Distributor: '🚚', Retailer: '🏪' }

/** Who licenses whom. */
export const LICENSES = {
  LocalGovt:    { target: 'Manufacturer', type: 'ManufacturingLicense', label: 'Manufacturing License' },
  Manufacturer: { target: 'Distributor',  type: 'TradeLicense',         label: 'Trade License' },
  Distributor:  { target: 'Retailer',     type: 'TradeLicense',         label: 'Trade License' },
}
export const ISSUER_OF = { Manufacturer: 'LocalGovt', Distributor: 'Manufacturer', Retailer: 'Distributor' }
export const LICENSE_LABEL = { ManufacturingLicense: 'Manufacturing License', TradeLicense: 'Trade License' }

export const STATUS = ['In stock', 'In transit', 'Delivered', 'Cancelled']
export const STATUS_PILL = ['pill-green', 'pill-amber', 'pill-blue', 'pill-red']

export function validateCompanyName(raw) {
  const n = (raw ?? '').trim()
  if (!n) return 'Enter your company name.'
  if (n.length < 2 || n.length > 64) return 'Use 2–64 characters.'
  return ''
}

const PREFIX = /^(TrustRegistry|DIDRegistry|CredentialRegistry|ProductTransfer|AuditLog|TraceabilityAudit):\s*/

/** Turn an ethers / MetaMask error into one readable sentence. */
export function errMsg(e) {
  if (!e) return 'Something went wrong.'
  if (e.code === 'ACTION_REJECTED' || e.info?.error?.code === 4001 || e.code === 4001) return 'You cancelled the request in MetaMask.'
  let s =
    e.reason ||
    e.revert?.args?.[0] ||
    e.info?.error?.data?.message ||
    e.info?.error?.message ||
    e.error?.message ||
    e.shortMessage ||
    e.message ||
    String(e)
  if (/insufficient funds/i.test(s)) return 'Not enough TRUST in this wallet to pay for gas.'
  if (/could not detect network|failed to fetch|network error/i.test(s)) return 'Cannot reach the blockchain node. Check your connection and try again.'
  s = s.replace(/^execution reverted:?\s*/i, '').replace(/^Error:\s*/i, '').replace(/^"|"$/g, '').replace(PREFIX, '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

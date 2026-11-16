import { ethers } from 'ethers'

export const ZERO = ethers.ZeroAddress
export const DAY = 86400

export const short = a => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
export const isZero = a => !a || a === ZERO

export const fmtDate = ts =>
  ts ? new Date(Number(ts) * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '-'
export const fmtDateTime = ts =>
  ts ? new Date(Number(ts) * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
export const nowSec = () => Math.floor(Date.now() / 1000)
export const daysLeft = ts => Math.ceil((Number(ts) - nowSec()) / DAY)

export const ROLES = ['LocalGovt', 'Manufacturer', 'Distributor', 'Retailer']
/** Roles a company can register itself. Local Governments are added by the Root Authority. */
export const SELF_ROLES = ['Manufacturer', 'Distributor', 'Retailer']
export const GITHUB_URL = 'https://github.com/MitulNeerubai/blockchain-supply-chain-security-research'

/** All 114 Missouri counties + St. Louis City, suggested for the Local Government region field (free text is allowed too). */
export const MO_REGIONS = [
  'Adair County, MO', 'Andrew County, MO', 'Atchison County, MO', 'Audrain County, MO', 'Barry County, MO',
  'Barton County, MO', 'Bates County, MO', 'Benton County, MO', 'Bollinger County, MO', 'Boone County, MO',
  'Buchanan County, MO', 'Butler County, MO', 'Caldwell County, MO', 'Callaway County, MO', 'Camden County, MO',
  'Cape Girardeau County, MO', 'Carroll County, MO', 'Carter County, MO', 'Cass County, MO', 'Cedar County, MO',
  'Chariton County, MO', 'Christian County, MO', 'Clark County, MO', 'Clay County, MO', 'Clinton County, MO',
  'Cole County, MO', 'Cooper County, MO', 'Crawford County, MO', 'Dade County, MO', 'Dallas County, MO',
  'Daviess County, MO', 'DeKalb County, MO', 'Dent County, MO', 'Douglas County, MO', 'Dunklin County, MO',
  'Franklin County, MO', 'Gasconade County, MO', 'Gentry County, MO', 'Greene County, MO', 'Grundy County, MO',
  'Harrison County, MO', 'Henry County, MO', 'Hickory County, MO', 'Holt County, MO', 'Howard County, MO',
  'Howell County, MO', 'Iron County, MO', 'Jackson County, MO', 'Jasper County, MO', 'Jefferson County, MO',
  'Johnson County, MO', 'Knox County, MO', 'Laclede County, MO', 'Lafayette County, MO', 'Lawrence County, MO',
  'Lewis County, MO', 'Lincoln County, MO', 'Linn County, MO', 'Livingston County, MO', 'McDonald County, MO',
  'Macon County, MO', 'Madison County, MO', 'Maries County, MO', 'Marion County, MO', 'Mercer County, MO',
  'Miller County, MO', 'Mississippi County, MO', 'Moniteau County, MO', 'Monroe County, MO', 'Montgomery County, MO',
  'Morgan County, MO', 'New Madrid County, MO', 'Newton County, MO', 'Nodaway County, MO', 'Oregon County, MO',
  'Osage County, MO', 'Ozark County, MO', 'Pemiscot County, MO', 'Perry County, MO', 'Pettis County, MO',
  'Phelps County, MO', 'Pike County, MO', 'Platte County, MO', 'Polk County, MO', 'Pulaski County, MO',
  'Putnam County, MO', 'Ralls County, MO', 'Randolph County, MO', 'Ray County, MO', 'Reynolds County, MO',
  'Ripley County, MO', 'St. Charles County, MO', 'St. Clair County, MO', 'Ste. Genevieve County, MO', 'St. Francois County, MO',
  'St. Louis County, MO', 'Saline County, MO', 'Schuyler County, MO', 'Scotland County, MO', 'Scott County, MO',
  'Shannon County, MO', 'Shelby County, MO', 'Stoddard County, MO', 'Stone County, MO', 'Sullivan County, MO',
  'Taney County, MO', 'Texas County, MO', 'Vernon County, MO', 'Warren County, MO', 'Washington County, MO',
  'Wayne County, MO', 'Webster County, MO', 'Worth County, MO', 'Wright County, MO', 'St. Louis City, MO',
]

/**
 * Optional product details a Manufacturer can show or hide on the public
 * product page (the page a QR scan opens). Bits match ProductTransfer.publicFields.
 * Name, manufacturer, verification result and chain of custody are always shown.
 */
export const PUBLIC_FIELDS = [
  { bit: 1, key: 'quantity', label: 'Quantity' },
  { bit: 2, key: 'batch', label: 'Batch number' },
  { bit: 4, key: 'description', label: 'Description' },
  { bit: 8, key: 'created', label: 'Created date' },
]
export const ALL_PUBLIC = 15
const BIT = Object.fromEntries(PUBLIC_FIELDS.map(f => [f.key, f.bit]))
/** Is this optional detail public for the product? */
export const isPublic = (p, key) => ((p?.publicFields ?? ALL_PUBLIC) & BIT[key]) !== 0
/** Labels of the optional details the public page shows / hides. */
export const publicLabels = (mask, shown = true) => PUBLIC_FIELDS.filter(f => ((mask & f.bit) !== 0) === shown).map(f => f.label)
/**
 * Who sees every detail regardless of the Manufacturer's choice: the Root
 * Authority, Local Governments, and any company that made or handled the product.
 * (`viewer` = { address, role } or null for the public.)
 */
export function seesAll(p, viewer) {
  if (!viewer?.address) return false
  if (viewer.role === 'RootGA' || viewer.role === 'LocalGovt') return true
  return sameAddr(p.manufacturer, viewer.address) || sameAddr(p.holder, viewer.address) || sameAddr(p.pending, viewer.address) ||
    (p.history || []).some(h => sameAddr(h.from, viewer.address) || sameAddr(h.to, viewer.address))
}
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

export const STATUS = ['In stock', 'In transit', 'Delivered', 'Deleted']
export const STATUS_PILL = ['pill-green', 'pill-amber', 'pill-blue', 'pill-gray']
/** TransferRecord.kind */
export const KIND = { SHIP: 0, RETURN: 1, RECALL: 2, RECLAIM: 3 }

/** Product form rules - must match ProductTransfer.createProduct. */
export const PRODUCT_LIMITS = { name: 80, batch: 40, description: 200, maxQty: 1_000_000_000 }
export function validateProduct(f) {
  const e = {}
  const name = (f.name ?? '').trim(), batch = (f.batch ?? '').trim(), desc = (f.description ?? '').trim()
  if (!name) e.name = 'Product name is required.'
  else if (name.length > PRODUCT_LIMITS.name) e.name = `Max ${PRODUCT_LIMITS.name} characters.`
  if (!batch) e.batch = 'Batch number is required.'
  else if (batch.length > PRODUCT_LIMITS.batch) e.batch = `Max ${PRODUCT_LIMITS.batch} characters.`
  if (!desc) e.description = 'Description is required.'
  else if (desc.length > PRODUCT_LIMITS.description) e.description = `Max ${PRODUCT_LIMITS.description} characters.`
  const q = String(f.quantity ?? '').trim()
  if (!/^\d+$/.test(q) || Number(q) < 1) e.quantity = 'Enter a whole number of at least 1.'
  else if (Number(q) > PRODUCT_LIMITS.maxQty) e.quantity = 'Quantity is too large.'
  return e
}

export function validateRegion(raw) {
  const n = (raw ?? '').trim()
  if (!n) return 'Enter the region this Local Government covers.'
  if (n.length < 2 || n.length > 64) return 'Use 2–64 characters.'
  return ''
}

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

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import './index.css'

/* ─── Chain ───────────────────────────────────────────────────────── */
const CHAIN_ID = 252501
const ADDR = {
  trust: '0xebb08092bB30ba254fb5c0268b1b55d3b57E0006',
  did:   '0x69c5b83617A11bB59c2585900E5E07fd0212A13e',
  cred:  '0x1F2Ae189038347cfEfF196C4CFF4f478fD4e2d55',
  pt:    '0x17ED77CDC9C3239a755AC0115eB67937526642E4',
  audit: '0x30191C6502C49a997bEA3fAD6FF120749AC7CF0b',
}

const ABI = {
  trust: [
    'function rootGA() view returns (address)',
    'function isAuthorizedIssuer(address) view returns (bool)',
    'function authorizeIssuer(address issuer, string role)',
    'function getIssuerCount() view returns (uint256)',
    'function getIssuerAt(uint256 index) view returns (address)',
  ],
  did: [
    'function getDID(address) view returns (tuple(string did, string role, address controller, uint256 createdAt, bool active))',
    'function registerDID(string role)',
    'event DIDRegistered(address indexed controller, string did, string role, uint256 timestamp)',
  ],
  cred: [
    'function issueCredential(address holder, string credType, uint256 expiresAt) returns (bytes32)',
    'function verifyCredential(bytes32 credentialId) view returns (bool)',
    'function isCredentialValid(address holder) view returns (bool)',
    'function getCredential(bytes32 credentialId) view returns (tuple(bytes32 id, address issuer, address holder, string credType, uint256 issuedAt, uint256 expiresAt, bool revoked, uint256 linkedProductId, bool productLinked))',
    'function revokeCredential(bytes32 credentialId)',
    'event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed holder, string credType, uint256 expiresAt)',
  ],
  pt: [
    'function createProduct(string name, string ipfsCID) returns (uint256)',
    'function shipTo(uint256 productId, address recipient)',
    'function confirmReceipt(uint256 productId)',
    'function cancelShipment(uint256 productId)',
    'function reclaimProduct(uint256 productId)',
    'function forceRecall(uint256 productId)',
    'function getProduct(uint256 productId) view returns (tuple(uint256 id, string name, string ipfsCID, address manufacturer, address currentHolder, address pendingRecipient, uint8 status, uint256 createdAt))',
    'function getTransferHistory(uint256 productId) view returns (tuple(address from, address to, uint256 timestamp, bool confirmed, bool cancelled)[])',
    'function getManufacturerProducts(address manufacturer) view returns (uint256[])',
    'function getHolderProducts(address holder) view returns (uint256[])',
    'function totalProducts() view returns (uint256)',
    'event ProductCreated(uint256 indexed id, address indexed manufacturer, string name)',
    'event ProductShipped(uint256 indexed id, address indexed from, address indexed to)',
    'event ProductReceived(uint256 indexed id, address indexed by)',
    'event ProductDelivered(uint256 indexed id, address indexed retailer)',
    'event ShipmentCancelled(uint256 indexed id, address indexed by, address indexed recipient)',
    'event ProductCancelled(uint256 indexed id, address indexed holder)',
    'event ProductReclaimed(uint256 indexed id, address indexed from, address indexed to)',
    'event ProductForceRecalled(uint256 indexed id, address indexed by, address indexed from)',
  ],
  audit: [
    'function auditProduct(uint256 productId) view returns (tuple(bool verified, uint256 productId, string productName, string ipfsCID, address manufacturer, address distributor, address retailer, uint256 manufacturedAt, uint256 shippedToDistributor, uint256 shippedToRetailer, string failReason))',
    'function isVerified(uint256 productId) view returns (bool)',
  ],
}

/* ─── localStorage helpers ────────────────────────────────────────── */
const ls = {
  get: (k, d = null) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
const getCompany  = a     => ls.get(`sc_co_${a?.toLowerCase()}`, '')
const saveCompany = (a,n) => ls.set(`sc_co_${a?.toLowerCase()}`, n)
const getPwHash   = a     => ls.get(`sc_pw_${a?.toLowerCase()}`)
const savePwHash  = (a,h) => ls.set(`sc_pw_${a?.toLowerCase()}`, h)
const hashPw      = p     => ethers.keccak256(ethers.toUtf8Bytes(p))
const checkPw     = (a,p) => getPwHash(a) === hashPw(p)

function getSavedAccounts() {
  try {
    return Object.keys(localStorage)
      .filter(k => k.startsWith('sc_pw_'))
      .map(k => {
        const addr = k.slice(6)
        return { address: addr, company: getCompany(addr) }
      })
  } catch { return [] }
}

/* ─── Display helpers ─────────────────────────────────────────────── */
const short       = a => a ? a.slice(0,6)+'…'+a.slice(-4) : ''
const displayName = a => { const c = getCompany(a); return c || short(a) }
const fmtDate     = ts => ts ? new Date(Number(ts)*1000).toLocaleDateString() : ''
const fmtDateTime = ts => ts ? new Date(Number(ts)*1000).toLocaleString() : ''

/* ─── OTP / Email API helpers ────────────────────────────────────── */
const API = '/api'

async function apiPost(path, body) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await r.json()
  if (!r.ok) throw new Error(json.error || 'Server error')
  return json
}

async function apiGet(path) {
  const r = await fetch(API + path)
  const json = await r.json()
  if (!r.ok) throw new Error(json.error || 'Server error')
  return json
}

/* ─── Error mapping ───────────────────────────────────────────────── */
function errMsg(e) {
  const s = (e?.data?.message || e?.reason || e?.message || String(e)).toLowerCase()
  if (s.includes('user rejected') || s.includes('user denied')) return 'You cancelled the transaction.'
  if (s.includes('insufficient funds')) return 'Not enough ETH for gas fees.'
  if (s.includes('already registered')) return 'This wallet is already registered on the blockchain.'
  if (s.includes('not authorized') || s.includes('not an issuer')) return 'Your wallet is not authorized for this action.'
  if (s.includes('no valid credential')) return 'Your wallet has no valid credential. Contact your Local Government.'
  if (s.includes('expired')) return 'Your credential has expired. Contact your Local Government for a new one.'
  if (s.includes('revoked')) return 'Your credential has been revoked. Contact your Local Government.'
  if (s.includes('not in stock')) return 'This product is currently in transit and cannot be shipped again.'
  if (s.includes('not in transit')) return 'No active shipment found for this product.'
  if (s.includes('pending recipient')) return 'You are not the designated recipient of this shipment.'
  if (s.includes('not current holder')) return 'You are not the current holder of this product.'
  if (s.includes('recipient has no valid credential')) return 'The recipient does not have a valid credential on the blockchain.'
  if (s.includes('not exist') || s.includes('not found')) return 'Product not found on the blockchain.'
  if (s.includes('only manufacturers')) return 'Only Manufacturers can create products.'
  if (s.includes('network') || s.includes('chain')) return 'Wrong network. Switch to DIDLab Besu in MetaMask.'
  if (s.includes('please install') || s.includes('metamask not found')) return e.message
  return 'Something went wrong. Please try again.'
}

/* ─── Visual Design System ──────────────────────────────────────── */
function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

      *, *::before, *::after { box-sizing: border-box; }

      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        background: #f3f4f6;
        color: #111827;
        margin: 0;
        min-height: 100vh;
      }

      /* ── Navbar ─────────────────────────────────────────────── */
      .navbar {
        background: linear-gradient(135deg, #1f2937 0%, #374151 60%, #4b5563 100%);
        border-bottom: 1px solid rgba(234,88,12,.3);
        padding: 0 24px;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: sticky;
        top: 0;
        z-index: 100;
        backdrop-filter: blur(10px);
        box-shadow: 0 4px 20px rgba(0,0,0,.15);
      }
      .navbar-brand {
        font-size: 1.1rem;
        font-weight: 800;
        color: #fff;
        letter-spacing: -.01em;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .navbar-right {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .navbar-addr {
        font-size: .8rem;
        font-weight: 500;
        color: rgba(255,255,255,.9);
        background: rgba(255,255,255,.2);
        padding: 4px 10px;
        border-radius: 20px;
      }

      /* ── Page layout ─────────────────────────────────────────── */
      .page {
        max-width: 1100px;
        margin: 0 auto;
        padding: 28px 20px 48px;
      }
      .page-title {
        font-size: 1.5rem;
        font-weight: 800;
        color: #111827;
        margin: 0 0 20px;
        letter-spacing: -.02em;
      }
      .cards-row {
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
      }
      .cards-row .card { flex: 1; min-width: 300px; }
      .cards-row .flex-2 { flex: 2; }
      .mt-4 { margin-top: 18px; }

      /* ── Cards ───────────────────────────────────────────────── */
      .card {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 20px;
        box-shadow: 0 2px 12px rgba(0,0,0,.06);
      }
      .card-title {
        font-weight: 700;
        font-size: 1rem;
        color: #111827;
        margin-bottom: 4px;
      }
      .card-sub {
        font-size: .82rem;
        color: #6b7280;
        margin-bottom: 16px;
        line-height: 1.5;
      }
      .card-header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }

      /* ── Center wrap (login pages) ───────────────────────────── */
      .center-wrap {
        min-height: calc(100vh - 60px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        background: linear-gradient(160deg, #f3f4f6 0%, #e5e7eb 60%);
      }
      .login-card {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 20px;
        padding: 36px 32px;
        width: 100%;
        max-width: 420px;
        box-shadow: 0 8px 40px rgba(0,0,0,.08), 0 2px 12px rgba(0,0,0,.06);
      }
      .login-logo {
        display: block;
        font-size: 2.5rem;
        text-align: center;
        margin-bottom: 8px;
      }
      .login-title {
        font-size: 1.6rem;
        font-weight: 900;
        color: #111827;
        text-align: center;
        margin: 0 0 6px;
        letter-spacing: -.03em;
      }
      .login-subtitle {
        font-size: .875rem;
        color: #6b7280;
        text-align: center;
        margin: 0 0 20px;
        line-height: 1.6;
      }
      .login-features {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 20px 0;
      }
      .feature {
        font-size: .82rem;
        color: #6b7280;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .login-note {
        font-size: .75rem;
        color: #9ca3af;
        text-align: center;
        margin: 16px 0 0;
      }
      .role-info {
        background: rgba(234,88,12,.08);
        border: 1px solid rgba(234,88,12,.2);
        border-radius: 8px;
        padding: 10px 14px;
        font-size: .82rem;
        color: #374151;
        margin-bottom: 16px;
      }
      .divider {
        text-align: center;
        color: #9ca3af;
        font-size: .8rem;
        font-weight: 600;
        margin: 16px 0;
        position: relative;
      }
      .divider::before, .divider::after {
        content: '';
        position: absolute;
        top: 50%;
        width: 42%;
        height: 1px;
        background: #e5e7eb;
      }
      .divider::before { left: 0; }
      .divider::after  { right: 0; }

      /* ── Buttons ─────────────────────────────────────────────── */
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: none;
        border-radius: 8px;
        padding: 8px 16px;
        font-size: .875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all .15s;
        font-family: inherit;
        white-space: nowrap;
        text-decoration: none;
      }
      .btn:disabled {
        opacity: .5;
        cursor: not-allowed;
      }
      .btn-primary {
        background: linear-gradient(135deg, #374151, #4b5563);
        color: #fff;
        box-shadow: 0 4px 14px rgba(234,88,12,.35);
      }
      .btn-primary:hover:not(:disabled) {
        background: linear-gradient(135deg, #1f2937, #374151);
        box-shadow: 0 6px 20px rgba(234,88,12,.45);
        transform: translateY(-1px);
      }
      .btn-success {
        background: linear-gradient(135deg, #059669, #10b981);
        color: #fff;
        box-shadow: 0 4px 14px rgba(16,185,129,.3);
      }
      .btn-success:hover:not(:disabled) {
        background: linear-gradient(135deg, #047857, #059669);
        transform: translateY(-1px);
      }
      .btn-danger {
        background: linear-gradient(135deg, #dc2626, #ef4444);
        color: #fff;
        box-shadow: 0 4px 14px rgba(220,38,38,.3);
      }
      .btn-danger:hover:not(:disabled) {
        background: linear-gradient(135deg, #b91c1c, #dc2626);
        transform: translateY(-1px);
      }
      .btn-outline {
        background: #f9fafb;
        color: #374151;
        border: 1px solid #d1d5db;
      }
      .btn-outline:hover:not(:disabled) {
        background: #f3f4f6;
        color: #111827;
        border-color: #9ca3af;
      }
      .btn-outline-white {
        background: rgba(255,255,255,.2);
        color: #fff;
        border: 1px solid rgba(255,255,255,.35);
        border-radius: 8px;
        padding: 5px 12px;
        font-size: .82rem;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: all .15s;
      }
      .btn-outline-white:hover {
        background: rgba(255,255,255,.3);
      }
      .btn-lg { padding: 12px 24px; font-size: .95rem; }
      .btn-sm { padding: 5px 12px; font-size: .78rem; }

      /* ── Forms ───────────────────────────────────────────────── */
      .form-group { margin-bottom: 14px; }
      .form-label {
        display: block;
        font-size: .8rem;
        font-weight: 600;
        color: #374151;
        margin-bottom: 5px;
        letter-spacing: .02em;
        text-transform: uppercase;
      }
      .form-input, .form-select {
        width: 100%;
        background: #f9fafb;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 10px 14px;
        color: #111827;
        font-size: .875rem;
        font-family: inherit;
        transition: all .15s;
        outline: none;
      }
      .form-input::placeholder { color: #9ca3af; }
      .form-input:focus, .form-select:focus {
        border-color: #6b7280;
        box-shadow: 0 0 0 3px rgba(107,114,128,.15);
        background: #ffffff;
      }
      .form-select option { background: #ffffff; color: #111827; }
      .form-select-sm { padding: 6px 10px; font-size: .82rem; }

      /* ── Alerts ──────────────────────────────────────────────── */
      .alert {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 10px;
        font-size: .85rem;
        margin-bottom: 14px;
        line-height: 1.5;
      }
      .alert-error   { background: rgba(239,68,68,.1);   color: #fca5a5; border: 1px solid rgba(239,68,68,.25); }
      .alert-success { background: rgba(16,185,129,.1);  color: #6ee7b7; border: 1px solid rgba(16,185,129,.25); }
      .alert-warning { background: rgba(245,158,11,.1);  color: #fcd34d; border: 1px solid rgba(245,158,11,.25); }
      .alert-info    { background: rgba(99,102,241,.1);  color: #a5b4fc; border: 1px solid rgba(99,102,241,.25); }
      .alert-close {
        background: none; border: none; cursor: pointer;
        color: inherit; font-size: 1.1rem; line-height: 1; opacity: .7; padding: 0;
      }
      .alert-close:hover { opacity: 1; }

      /* ── Badges ──────────────────────────────────────────────── */
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 20px;
        font-size: .73rem;
        font-weight: 700;
        color: #fff;
        letter-spacing: .03em;
        text-transform: uppercase;
      }

      /* ── Spinner ─────────────────────────────────────────────── */
      .spinner {
        display: inline-block;
        border: 2px solid rgba(255,255,255,.2);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin .6s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ── Status badges ───────────────────────────────────────── */
      .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 20px;
        font-size: .73rem;
        font-weight: 700;
        letter-spacing: .03em;
      }
      .status-stock     { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
      .status-transit   { background: #fef9c3; color: #a16207; border: 1px solid #fde047; }
      .status-done      { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
      .status-cancelled { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }

      /* ── Account list ─────────────────────────────────────────── */
      .account-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 4px;
      }
      .account-item {
        display: flex;
        align-items: center;
        gap: 12px;
        background: #f3f4f6;
        border: 1px solid #d1d5db;
        border-radius: 10px;
        padding: 10px 14px;
        cursor: pointer;
        transition: all .15s;
        font-family: inherit;
        width: 100%;
        text-align: left;
      }
      .account-item:hover { background: #e5e7eb; border-color: #9ca3af; transform: translateY(-1px); }
      .account-avatar {
        width: 40px; height: 40px;
        border-radius: 50%;
        background: linear-gradient(135deg, #374151, #4b5563);
        display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: .95rem; color: #fff;
        flex-shrink: 0;
      }
      .account-name { font-weight: 700; font-size: .9rem; color: #111827; }
      .account-addr { font-size: .75rem; color: #6b7280; margin-top: 2px; font-family: monospace; }
      .account-info { flex: 1; }
      .account-arrow { font-size: 1.2rem; color: #374151; font-weight: 700; }

      /* ── Inventory, product, credential, transfer cards ──────── */
      .inventory-item {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 14px 16px;
        margin-bottom: 10px;
        transition: border-color .15s;
      }
      .inventory-item.verified { border-color: #bbf7d0; }
      .inventory-item:hover { border-color: #9ca3af; }

      .product-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 0;
        border-bottom: 1px solid #f3f4f6;
      }
      .product-row:last-child { border-bottom: none; }
      .product-name { font-weight: 600; font-size: .9rem; color: #111827; }

      .transfer-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 10px;
        padding: 12px 16px;
        margin-bottom: 8px;
      }
      .transfer-info { flex: 1; }
      .transfer-from { font-size: .78rem; color: #6b7280; margin-top: 3px; }

      .did-banner {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.4);
        border-radius: 10px; padding: 12px 16px; margin-bottom: 20px;
        color: #fbbf24; font-size: 14px; flex-wrap: wrap;
      }
      .did-banner.did-ok {
        background: rgba(16,185,129,.1); border-color: rgba(16,185,129,.35);
        color: #34d399; justify-content: flex-start;
      }
      .btn-warning {
        background: rgba(245,158,11,.2); border: 1px solid rgba(245,158,11,.5);
        color: #fbbf24; white-space: nowrap;
      }
      .btn-warning:hover:not(:disabled) { background: rgba(245,158,11,.35); }
      .cred-card {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 12px 16px;
        margin-bottom: 8px;
      }
      .cred-card.revoked { border-color: #fecaca; opacity: .65; }
      .cred-type { font-weight: 700; font-size: .9rem; color: #374151; margin-bottom: 4px; }
      .cred-meta { font-size: .8rem; color: #6b7280; margin-top: 2px; }
      .cred-type-tag {
        display: inline-block;
        background: #f3f4f6;
        color: #374151;
        border-radius: 6px;
        padding: 2px 8px;
        font-size: .73rem;
        font-weight: 600;
      }
      .revoked-tag {
        display: inline-block;
        background: #fee2e2;
        color: #dc2626;
        border-radius: 6px;
        padding: 2px 8px;
        font-size: .72rem;
        font-weight: 700;
        letter-spacing: .04em;
      }

      /* ── Ship panel ──────────────────────────────────────────── */
      .ship-panel {
        margin-top: 12px;
        padding: 12px;
        background: #f3f4f6;
        border: 1px solid #d1d5db;
        border-radius: 8px;
      }
      .ship-panel-title {
        font-size: .78rem;
        font-weight: 700;
        color: #374151;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      .ship-row { display: flex; gap: 8px; align-items: center; }

      /* ── Candidate / Issuer rows ─────────────────────────────── */
      .candidate-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 0;
        border-bottom: 1px solid #f3f4f6;
      }
      .candidate-row:last-of-type { border-bottom: none; }
      .issuer-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 0;
        border-bottom: 1px solid #f3f4f6;
      }
      .issuer-row:last-child { border-bottom: none; }

      /* ── Addr / misc ─────────────────────────────────────────── */
      .addr-text { font-size: .73rem; color: #6b7280; font-family: monospace; margin-top: 2px; word-break: break-all; }
      .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 32px 16px;
        font-size: .85rem;
        color: #9ca3af;
        border-radius: 8px;
        background: #f9fafb;
        border: 1px dashed #e5e7eb;
      }

      /* ── Scrollbar ───────────────────────────────────────────── */
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #9ca3af; }

      code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; color: #374151; font-size: .85em; }
    `}</style>
  )
}


/* ─── Contract factory ────────────────────────────────────────────── */
const getC = signer => ({
  trust: new ethers.Contract(ADDR.trust, ABI.trust, signer),
  did:   new ethers.Contract(ADDR.did,   ABI.did,   signer),
  cred:  new ethers.Contract(ADDR.cred,  ABI.cred,  signer),
  pt:    new ethers.Contract(ADDR.pt,    ABI.pt,    signer),
  audit: new ethers.Contract(ADDR.audit, ABI.audit, signer),
})

/* ─── Chunked log query ───────────────────────────────────────────── */
async function chunkedLogs(contract, filter, from, to, chunk=2000) {
  const out = []
  for (let b = from; b <= to; b += chunk) {
    try { out.push(...await contract.queryFilter(filter, b, Math.min(b+chunk-1, to))) } catch {}
  }
  return out
}

/* ─── Role detection ──────────────────────────────────────────────── */
async function detectRole(address, provider) {
  try {
    console.log('[detectRole] address:', address)
    const trust = new ethers.Contract(ADDR.trust, ABI.trust, provider)
    const didC  = new ethers.Contract(ADDR.did,   ABI.did,   provider)
    const root  = await trust.rootGA()
    console.log('[detectRole] rootGA:', root)
    if (root.toLowerCase() === address.toLowerCase()) return 'RootGA'
    const isIssuer = await trust.isAuthorizedIssuer(address)
    console.log('[detectRole] isAuthorizedIssuer:', isIssuer)
    if (isIssuer) return 'LocalGovt'
    const d = await didC.getDID(address)
    console.log('[detectRole] getDID result:', d, 'active:', d.active, 'role:', d.role)
    if (d.active && d.role?.trim()) return d.role.trim()
    return null
  } catch (e) {
    console.error('[detectRole] ERROR:', e)
    return null
  }
}

/* ─── Check if address has a valid credential ─────────────────────── */
async function hasValidCred(address, provider) {
  try {
    const credC = new ethers.Contract(ADDR.cred, ABI.cred, provider)
    return await credC.isCredentialValid(address)
  } catch { return false }
}

/* ─── Load all registered actors by role ─────────────────────────── */
async function loadActors(provider) {
  const didC   = new ethers.Contract(ADDR.did, ABI.did, provider)
  const latest = await provider.getBlockNumber()
      console.log('MF block:', latest)
  const from   = Math.max(0, latest - 2000)
  const logs   = await chunkedLogs(didC, didC.filters.DIDRegistered(), from, latest)
  const seen   = new Set()
  const out    = { Manufacturer:[], Distributor:[], Retailer:[] }
  for (const log of logs) {
    const addr = log.args.controller.toLowerCase()
    if (seen.has(addr)) continue; seen.add(addr)
    try {
      const d = await didC.getDID(log.args.controller)
      if (d.active && out[d.role?.trim()]) {
        const name = getCompany(log.args.controller) || `${d.role.trim()} (${short(log.args.controller)})`
        out[d.role.trim()].push({ address: log.args.controller, company: name })
      }
    } catch {}
  }
  return out
}

/* ─── Load ALL DID-registered wallets (for RootGA picker) ────────── */
async function loadAllRegistered(provider) {
  const didC   = new ethers.Contract(ADDR.did, ABI.did, provider)
  const latest = await provider.getBlockNumber()
  const from   = Math.max(0, latest - 2000)
  const logs   = await chunkedLogs(didC, didC.filters.DIDRegistered(), from, latest)
  const seen   = new Set()
  const out    = []
  for (const log of logs) {
    const addr = log.args.controller.toLowerCase()
    if (seen.has(addr)) continue; seen.add(addr)
    try {
      const d = await didC.getDID(log.args.controller)
      if (d.active)
        out.push({ address: log.args.controller, role: d.role?.trim(), company: displayName(log.args.controller) })
    } catch {}
  }
  return out
}

/* ─── Verify URL ──────────────────────────────────────────────────── */
function verifyUrl(productId) {
  const base = window.location.origin + window.location.pathname
  return `${base}?verify=${productId}`
}

/* ─── QR code image (via free public API) ────────────────────────── */
function QRCodeImg({ url, size=180 }) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`
  return (
    <img src={src} alt="QR code" width={size} height={size}
      style={{borderRadius:8, border:'1px solid #e2e8f0', display:'block'}}/>
  )
}

/* ─── Shared UI components ────────────────────────────────────────── */
const ROLE_COLOR = {
  RootGA:'#854d0e', LocalGovt:'#6d28d9',
  Manufacturer:'#1e40af', Distributor:'#b45309', Retailer:'#065f46'
}

function Badge({ role }) {
  return <span className="badge" style={{background: ROLE_COLOR[role]||'#64748b'}}>{role}</span>
}

function Alert({ type='info', children, onClose }) {
  return (
    <div className={`alert alert-${type}`}>
      <span>{children}</span>
      {onClose && <button className="alert-close" onClick={onClose}>×</button>}
    </div>
  )
}

function Spin({ size=16 }) {
  return <span className="spinner" style={{width:size, height:size}} />
}

function Navbar({ address, role, onLogout }) {
  return (
    <nav className="navbar">
      <div className="navbar-brand">🔗 DIDLab Supply Chain</div>
      <div className="navbar-right">
        {role && <Badge role={role} />}
        {address && <span className="navbar-addr">{getCompany(address) || short(address)}</span>}
        {address && <button className="btn btn-outline-white" onClick={onLogout}>Logout</button>}
      </div>
    </nav>
  )
}

/* ─── Product Search (shared) ─────────────────────────────────────── */
function ProductSearch({ provider }) {
  const [id, setId]     = useState('')
  const [prod, setProd] = useState(null)
  const [hist, setHist] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  async function search(e) {
    e.preventDefault(); setErr(''); setProd(null); setHist([]); setBusy(true)
    try {
      const ptC = new ethers.Contract(ADDR.pt, ABI.pt, provider)
      const pid = BigInt(id.trim())
      const p   = await ptC.getProduct(pid)
      if (!p.id || p.id.toString() === '0') throw new Error('not found')
      const statuses = ['In Stock','In Transit','Delivered','Cancelled']
      setProd({ id: pid, name: p.name, manufacturer: p.manufacturer, holder: p.currentHolder, status: statuses[p.status] || 'Unknown' })
      const history = await ptC.getTransferHistory(pid)
      setHist(history.map(h => ({ from: h.from, to: h.to, timestamp: h.timestamp, confirmed: h.confirmed, cancelled: h.cancelled })))
    } catch(e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  return (
    <div className="card mt-4">
      <div className="card-title">🔍 Product Lookup</div>
      <div className="card-sub">Search any product by ID to view its status and full transfer history</div>
      <form onSubmit={search} style={{display:'flex', gap:8, marginBottom:12}}>
        <input className="form-input" placeholder="Product ID (number)" value={id}
          onChange={e=>setId(e.target.value)} style={{flex:1}} />
        <button className="btn btn-primary" type="submit" disabled={busy||!id.trim()}>
          {busy ? <Spin/> : 'Search'}
        </button>
      </form>
      {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
      {prod && (
        <div className="inventory-item verified">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
            <strong style={{fontSize:'1rem'}}>{prod.name}</strong>
            <span className="cred-type-tag">ID #{prod.id.toString()}</span>
          </div>
          <div className="cred-meta">Manufacturer: <strong>{displayName(prod.manufacturer)}</strong></div>
          <div className="cred-meta">Current holder: <strong>{displayName(prod.holder)}</strong></div>
          <div className="cred-meta">Status: <strong>{prod.status}</strong></div>
          {hist.length > 0 && (
            <div style={{marginTop:12}}>
              <div style={{fontWeight:700, fontSize:'.8rem', color:'#374151', marginBottom:8, textTransform:'uppercase', letterSpacing:'.04em'}}>Transfer History</div>
              {hist.map((h,i) => (
                <div key={i} style={{display:'flex', gap:10, alignItems:'center', padding:'7px 0', borderBottom:'1px solid #f1f5f9', fontSize:'.82rem', opacity: h.cancelled ? 0.55 : 1}}>
                  <span style={{minWidth:16}}>{h.cancelled ? '🚫' : h.confirmed ? '✅' : '⏳'}</span>
                  <span style={{color:'#475569', textDecoration: h.cancelled ? 'line-through' : 'none'}}>{displayName(h.from)} → {displayName(h.to)}</span>
                  {h.cancelled && <span style={{color:'#dc2626', fontSize:'.72rem', fontWeight:700, marginLeft:4}}>CANCELLED</span>}
                  <span style={{marginLeft:'auto', color:'#94a3b8', fontSize:'.75rem'}}>{fmtDate(h.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Public Verify Page  (no login needed — scan QR to reach here)    */
/* ══════════════════════════════════════════════════════════════════ */
function VerifyPage({ productId }) {
  const [result, setResult] = useState(null)
  const [credStatus, setCredStatus] = useState({}) // { mf: bool, dt: bool, rt: bool }
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    async function run() {
      try {
        const provider = new ethers.JsonRpcProvider('https://eth.didlab.org')
        const auditC   = new ethers.Contract(ADDR.audit, ABI.audit, provider)
        const credC    = new ethers.Contract(ADDR.cred,  ABI.cred,  provider)
        const r        = await auditC.auditProduct(BigInt(productId))
        setResult(r)
        // Load credential validity for each party
        const cs = {}
        const zero = '0x0000000000000000000000000000000000000000'
        if (r.manufacturer && r.manufacturer !== zero)
          try { cs.mf = await credC.isCredentialValid(r.manufacturer) } catch { cs.mf = false }
        if (r.distributor && r.distributor !== zero)
          try { cs.dt = await credC.isCredentialValid(r.distributor) } catch { cs.dt = false }
        if (r.retailer && r.retailer !== zero)
          try { cs.rt = await credC.isCredentialValid(r.retailer) } catch { cs.rt = false }
        setCredStatus(cs)
      } catch(e) {
        setErr('Could not load product verification data. ' + errMsg(e))
      }
      setLoading(false)
    }
    run()
  }, [productId])

  return (
    <><Styles/><div style={{minHeight:'100vh', background:'#f3f4f6', color:'#111827'}}>
      <nav className="navbar">
        <div className="navbar-brand">🔗 DIDLab Supply Chain</div>
        <div className="navbar-right">
          <span style={{fontSize:'.8rem', color:'#94a3b8'}}>Product Verification</span>
        </div>
      </nav>
      <div className="center-wrap">
        <div className="login-card" style={{maxWidth:520, textAlign:'left'}}>
          {loading && (
            <div style={{textAlign:'center', padding:'32px 0'}}>
              <Spin size={36}/><p style={{marginTop:16, color:'#64748b'}}>Verifying on blockchain…</p>
            </div>
          )}
          {err && <Alert type="error">{err}</Alert>}
          {result && (
            <>
              <div style={{textAlign:'center', marginBottom:24}}>
                <div style={{fontSize:'3rem', marginBottom:8}}>
                  {result.verified ? '✅' : '❌'}
                </div>
                <h2 style={{fontSize:'1.5rem', fontWeight:900, color:'#0f172a', marginBottom:4}}>
                  {result.verified ? 'Chain Verified' : 'Verification Failed'}
                </h2>
                <div style={{fontSize:'.9rem', color:result.verified?'#065f46':'#991b1b', fontWeight:600}}>
                  {result.verified ? 'Complete MF → DT → RT chain confirmed on DIDLab Besu' : result.failReason}
                </div>
              </div>

              <div style={{background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'16px 18px', marginBottom:16}}>
                <div style={{fontWeight:700, fontSize:'.8rem', color:'#374151', marginBottom:12, textTransform:'uppercase', letterSpacing:'.04em'}}>
                  Product Details
                </div>
                <div style={{display:'flex', flexDirection:'column', gap:8, fontSize:'.875rem'}}>
                  <div style={{display:'flex', justifyContent:'space-between'}}>
                    <span style={{color:'#64748b'}}>Product ID</span>
                    <strong>#{result.productId?.toString()}</strong>
                  </div>
                  <div style={{display:'flex', justifyContent:'space-between'}}>
                    <span style={{color:'#64748b'}}>Name</span>
                    <strong>{result.productName}</strong>
                  </div>
                  {result.manufacturedAt > 0 && (
                    <div style={{display:'flex', justifyContent:'space-between'}}>
                      <span style={{color:'#64748b'}}>Created</span>
                      <strong>{fmtDateTime(result.manufacturedAt)}</strong>
                    </div>
                  )}
                </div>
              </div>

              {result.verified && (
                <div style={{background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'16px 18px'}}>
                  <div style={{fontWeight:700, fontSize:'.8rem', color:'#065f46', marginBottom:12, textTransform:'uppercase', letterSpacing:'.04em'}}>
                    Verified Chain of Custody
                  </div>
                  <div style={{display:'flex', flexDirection:'column', gap:10, fontSize:'.85rem'}}>
                    {[
                      { label:'🏭 Manufacturer', addr: result.manufacturer, time: result.manufacturedAt,       credKey:'mf' },
                      { label:'🚚 Distributor',  addr: result.distributor,  time: result.shippedToDistributor, credKey:'dt' },
                      { label:'🏪 Retailer',     addr: result.retailer,     time: result.shippedToRetailer,    credKey:'rt' },
                    ].map((row,i) => {
                      const isValid = credStatus[row.credKey]
                      const hasAddr = row.addr && row.addr !== '0x0000000000000000000000000000000000000000'
                      return (
                        <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'8px 0', borderBottom: i<2 ? '1px solid #d1fae5' : 'none'}}>
                          <div>
                            <div style={{fontWeight:700, color:'#065f46'}}>{row.label}</div>
                            <div style={{fontFamily:'monospace', fontSize:'.73rem', color:'#94a3b8', marginTop:2}}>{row.addr}</div>
                            {row.time > 0 && <div style={{fontSize:'.75rem', color:'#64748b', marginTop:2}}>{fmtDateTime(row.time)}</div>}
                          </div>
                          <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4}}>
                            <span style={{color:'#059669', fontSize:'1.2rem'}}>✓</span>
                            {hasAddr && (
                              <span style={{
                                fontSize:'.72rem', fontWeight:700, padding:'2px 7px', borderRadius:12,
                                background: isValid ? '#dcfce7' : '#fee2e2',
                                color: isValid ? '#15803d' : '#991b1b',
                                border: isValid ? '1px solid #bbf7d0' : '1px solid #fecaca',
                              }}>
                                {isValid ? '🟢 Cred Active' : '🔴 Cred Revoked'}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div style={{marginTop:16, textAlign:'center', fontSize:'.75rem', color:'#94a3b8'}}>
                Verified on DIDLab Hyperledger Besu · Block explorer: eth.didlab.org
              </div>
            </>
          )}
        </div>
      </div>
    </div></>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Account Picker  (first screen)                                    */
/* ══════════════════════════════════════════════════════════════════ */
function AccountPickerPage({ onConnect }) {
  const accounts = getSavedAccounts()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')

  async function connect() {
    setErr(''); setBusy(true)
    try {
      if (!window.ethereum) throw new Error('Please install MetaMask to continue.')
      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const net = await provider.getNetwork()
      if (Number(net.chainId) !== CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x' + CHAIN_ID.toString(16) }],
          })
        } catch { throw new Error('Wrong network — please switch to DIDLab Besu in MetaMask.') }
      }
      const signer  = await provider.getSigner()
      const address = await signer.getAddress()
      onConnect(provider, signer, address)
    } catch(e) { setErr(e.message || errMsg(e)) }
    setBusy(false)
  }

  return (
    <div className="center-wrap">
      <div className="login-card">
        <span className="login-logo">🔗</span>
        <h1 className="login-title">DIDLab Supply Chain</h1>
        <p className="login-subtitle">Blockchain-verified product traceability<br/>powered by DIDLab Hyperledger Besu</p>

        {accounts.length > 0 && (
          <>
            <div style={{fontWeight:700, fontSize:'.82rem', color:'#374151', textAlign:'left', marginBottom:10, textTransform:'uppercase', letterSpacing:'.04em'}}>
              Your accounts on this device
            </div>
            <div className="account-list">
              {accounts.map((acc,i) => (
                <button key={i} className="account-item" onClick={connect} disabled={busy}>
                  <div className="account-avatar">
                    {(acc.company || acc.address)[0]?.toUpperCase()}
                  </div>
                  <div className="account-info">
                    <div className="account-name">{acc.company || 'Unnamed Account'}</div>
                    <div className="account-addr">{acc.address.slice(0,6)}…{acc.address.slice(-4)}</div>
                  </div>
                  <span className="account-arrow">›</span>
                </button>
              ))}
            </div>
            <div className="divider">or</div>
          </>
        )}

        {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}

        <button className="btn btn-primary btn-lg" style={{width:'100%'}} onClick={connect} disabled={busy}>
          {busy ? <><Spin/> Connecting…</> : accounts.length > 0 ? '🦊 Connect different wallet' : '🦊 Connect MetaMask'}
        </button>
        {accounts.length === 0 && (
          <div className="login-features" style={{marginTop:20, marginBottom:0}}>
            <div className="feature">✅ Self-Sovereign Identity (SSI/DID)</div>
            <div className="feature">🔐 Verifiable Credentials (W3C VC)</div>
            <div className="feature">📦 End-to-end product traceability</div>
            <div className="feature">🏛️ Decentralized trust — no central authority</div>
          </div>
        )}
        <p className="login-note">Make sure MetaMask is set to the DIDLab Besu network</p>
      </div>
    </div>
  )
}

/* AccountSettings removed — settings section not needed for research demo */

/* ══════════════════════════════════════════════════════════════════ */
/*  Set Password + Name (first time for this wallet)                  */
/* ══════════════════════════════════════════════════════════════════ */
function SetPasswordPage({ address, onDone }) {
  const [name, setName] = useState('')
  const [pw,   setPw]   = useState('')
  const [pw2,  setPw2]  = useState('')
  const [err,  setErr]  = useState('')

  function submit(e) {
    e.preventDefault(); setErr('')
    if (!name.trim())    return setErr('Please enter your company or display name.')
    if (pw.length < 6)   return setErr('Password must be at least 6 characters.')
    if (pw !== pw2)       return setErr('Passwords do not match.')
    saveCompany(address, name.trim())
    savePwHash(address, hashPw(pw))
    onDone()
  }

  return (
    <div className="center-wrap">
      <div className="login-card" style={{maxWidth:460}}>
        <span className="login-logo">🔑</span>
        <h1 className="login-title">Create Account</h1>
        <p className="login-subtitle">Set your display name and a personal password.<br/>You'll use this every time you log in from this device.</p>
        <div className="role-info" style={{textAlign:'left'}}>
          Connected wallet: <code style={{fontSize:'.8rem', fontWeight:600}}>{short(address)}</code>
        </div>
        {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">Company / Display Name</label>
            <input className="form-input" placeholder="e.g. Acme Corp, Root Authority" value={name}
              onChange={e=>setName(e.target.value)} autoFocus />
            <div style={{fontSize:'.75rem', color:'#94a3b8', marginTop:5}}>This name appears in your navbar and is visible to others in the system.</div>
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" placeholder="At least 6 characters" value={pw}
              onChange={e=>setPw(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input className="form-input" type="password" placeholder="Repeat your password" value={pw2}
              onChange={e=>setPw2(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-lg" style={{width:'100%'}} type="submit">
            Create Account →
          </button>
        </form>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Password Login (returning user)                                   */
/* ══════════════════════════════════════════════════════════════════ */
function PasswordLoginPage({ address, onDone, onSwitchWallet }) {
  const [pw,  setPw]  = useState('')
  const [err, setErr] = useState('')
  const co = getCompany(address)

  function submit(e) {
    e.preventDefault(); setErr('')
    if (!checkPw(address, pw)) return setErr('Wrong password. Please try again.')
    onDone()
  }

  return (
    <div className="center-wrap">
      <div className="login-card">
        <span className="login-logo">👋</span>
        <h1 className="login-title">Welcome Back</h1>
        {co && <p style={{fontSize:'1.1rem', fontWeight:700, color:'#0f172a', marginBottom:4}}>{co}</p>}
        <p className="login-subtitle">
          <code style={{fontSize:'.8rem', background:'#f1f5f9', padding:'2px 8px', borderRadius:5}}>{short(address)}</code>
        </p>
        {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" placeholder="Enter your password" value={pw}
              onChange={e=>setPw(e.target.value)} autoFocus />
          </div>
          <button className="btn btn-primary btn-lg" style={{width:'100%'}} type="submit">Log In</button>
        </form>
        <button className="btn btn-outline" style={{width:'100%', marginTop:10}} onClick={onSwitchWallet}>
          ← Use a different account
        </button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Register DID                                                      */
/* ══════════════════════════════════════════════════════════════════ */
/* ─── Reusable EmailSettings component ───────────────────────────── */
// roleKey: "LG" | "MF" | "DT" | "RT"
function EmailSettings({ roleKey }) {
  const [currentEmail, setCurrentEmail] = useState('')
  const [newEmail,     setNewEmail]     = useState('')
  const [otp,          setOtp]          = useState('')
  const [step,         setStep]         = useState('idle') // idle | sent | done
  const [busy,         setBusy]         = useState(false)
  const [err,          setErr]          = useState('')
  const [ok,           setOk]           = useState('')

  useEffect(() => {
    apiGet('/email/' + roleKey)
      .then(d => setCurrentEmail(d.email || ''))
      .catch(() => {})
  }, [roleKey])

  async function sendOtp() {
    setErr(''); setOk(''); setBusy(true)
    try {
      const r = await apiPost('/email/send-otp', { email: newEmail.trim(), role: roleKey })
      setOk(r.message); setStep('sent')
    } catch(e) { setErr(e.message) }
    setBusy(false)
  }

  async function verifyOtp() {
    setErr(''); setOk(''); setBusy(true)
    try {
      const r = await apiPost('/email/verify-otp', { email: newEmail.trim(), role: roleKey, otp: otp.trim() })
      setOk(r.message); setCurrentEmail(newEmail.trim()); setStep('done')
      setNewEmail(''); setOtp('')
    } catch(e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="card" style={{marginTop:24}}>
      <div className="card-header">
        <h3 className="card-title">📧 Notification Email</h3>
      </div>
      <div style={{padding:'16px 20px'}}>
        {currentEmail
          ? <p style={{margin:'0 0 12px', fontSize:'.9rem'}}>
              Current: <strong>{currentEmail}</strong>
              <span style={{marginLeft:8, opacity:.6, fontSize:'.8rem'}}>— supply chain alerts go here</span>
            </p>
          : <p style={{margin:'0 0 12px', fontSize:'.9rem', opacity:.7}}>No email set — you won't receive notifications.</p>
        }
        {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
        {ok  && <Alert type="success">{ok}</Alert>}

        {step !== 'sent' && (
          <div style={{display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap'}}>
            <div className="form-group" style={{flex:1, minWidth:200, margin:0}}>
              <label className="form-label">{currentEmail ? 'New email address' : 'Your email address'}</label>
              <input
                className="form-input"
                type="email"
                placeholder="you@example.com"
                value={newEmail}
                onChange={e=>{setNewEmail(e.target.value); setStep('idle'); setErr(''); setOk('')}}
              />
            </div>
            <button className="btn btn-primary" onClick={sendOtp}
              disabled={busy || !newEmail.trim().includes('@')} style={{marginBottom:0}}>
              {busy ? <><Spin/> Sending…</> : 'Send Code'}
            </button>
          </div>
        )}

        {step === 'sent' && (
          <div style={{display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap', marginTop:8}}>
            <div className="form-group" style={{flex:1, minWidth:150, margin:0}}>
              <label className="form-label">6-digit code sent to {newEmail}</label>
              <input
                className="form-input"
                type="text"
                placeholder="123456"
                maxLength={6}
                value={otp}
                onChange={e=>setOtp(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={verifyOtp}
              disabled={busy || otp.trim().length < 6}>
              {busy ? <><Spin/> Verifying…</> : 'Verify & Save'}
            </button>
            <button className="btn btn-outline" onClick={()=>setStep('idle')}>← Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── RegisterPage with email OTP ────────────────────────────────── */
function RegisterPage({ signer, address, provider, onDone }) {
  const [role,     setRole]    = useState('Manufacturer')
  const [email,    setEmail]   = useState('')
  const [otp,      setOtp]     = useState('')
  const [otpStep,  setOtpStep] = useState('idle') // idle | sent | verified
  const [busy,     setBusy]    = useState(false)
  const [otpBusy,  setOtpBusy] = useState(false)
  const [err,      setErr]     = useState('')
  const [ok,       setOk]      = useState('')
  const co = getCompany(address)

  const roleKeyMap = { Manufacturer:'MF', Distributor:'DT', Retailer:'RT' }

  async function sendOtp() {
    setErr(''); setOk(''); setOtpBusy(true)
    try {
      const r = await apiPost('/email/send-otp', { email: email.trim(), role: roleKeyMap[role] })
      setOk(r.message); setOtpStep('sent')
    } catch(e) { setErr(e.message) }
    setOtpBusy(false)
  }

  async function verifyOtp() {
    setErr(''); setOk(''); setOtpBusy(true)
    try {
      const r = await apiPost('/email/verify-otp', { email: email.trim(), role: roleKeyMap[role], otp: otp.trim() })
      setOk(r.message + ' Now registering on blockchain…'); setOtpStep('verified')
    } catch(e) { setErr(e.message) }
    setOtpBusy(false)
  }

  async function register(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const C  = getC(signer)
      const tx = await C.did.registerDID(role)
      setOk('Confirming on blockchain…')
      await tx.wait()
      setOk('Registered! Loading your dashboard…')
      setTimeout(onDone, 1000)
    } catch(e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  const emailValid = email.trim().includes('@')
  const canRegister = otpStep === 'verified'

  return (
    <div className="center-wrap">
      <div className="login-card" style={{maxWidth:480}}>
        <span className="login-logo">📋</span>
        <h1 className="login-title">Register on Chain</h1>
        <p className="login-subtitle">
          {co ? <><strong>{co}</strong>, register<br/>your role</> : 'Register your role'} on the supply chain network.<br/>
          You need a credential from Local Government first.
        </p>
        <div className="role-info" style={{textAlign:'left'}}>
          Wallet: <code style={{fontSize:'.8rem', fontWeight:600}}>{short(address)}</code>
        </div>
        {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
        {ok  && <Alert type="success">{ok}</Alert>}

        <form onSubmit={register}>
          {/* Step 1: Role */}
          <div className="form-group">
            <label className="form-label">Your Role</label>
            <select className="form-select" value={role}
              onChange={e=>{ setRole(e.target.value); setOtpStep('idle'); setOtp(''); setOk('') }}>
              <option value="Manufacturer">🏭 Manufacturer</option>
              <option value="Distributor">🚚 Distributor</option>
              <option value="Retailer">🏪 Retailer</option>
            </select>
          </div>

          {/* Step 2: Email + OTP */}
          <div className="form-group">
            <label className="form-label">📧 Notification Email</label>
            <div style={{display:'flex', gap:8}}>
              <input
                className="form-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                disabled={otpStep === 'sent' || otpStep === 'verified'}
                onChange={e=>{ setEmail(e.target.value); setOtpStep('idle'); setOtp(''); setOk('') }}
                style={{flex:1}}
              />
              {otpStep !== 'verified' && (
                <button type="button" className="btn btn-outline" onClick={sendOtp}
                  disabled={otpBusy || !emailValid || otpStep === 'sent'}>
                  {otpBusy && otpStep !== 'sent' ? <Spin/> : otpStep === 'sent' ? '✉️ Sent' : 'Send Code'}
                </button>
              )}
              {otpStep === 'verified' && <span style={{alignSelf:'center', color:'#16a34a', fontWeight:600}}>✅ Verified</span>}
            </div>
          </div>

          {otpStep === 'sent' && (
            <div className="form-group">
              <label className="form-label">Enter 6-digit code from your email</label>
              <div style={{display:'flex', gap:8}}>
                <input
                  className="form-input"
                  type="text"
                  placeholder="123456"
                  maxLength={6}
                  value={otp}
                  onChange={e=>setOtp(e.target.value)}
                  style={{flex:1, letterSpacing:'.2em', fontSize:'1.1rem'}}
                />
                <button type="button" className="btn btn-primary" onClick={verifyOtp}
                  disabled={otpBusy || otp.trim().length < 6}>
                  {otpBusy ? <Spin/> : 'Verify'}
                </button>
                <button type="button" className="btn btn-outline" onClick={()=>setOtpStep('idle')}>←</button>
              </div>
            </div>
          )}

          <button className="btn btn-primary btn-lg" style={{width:'100%', marginTop:8}} type="submit"
            disabled={busy || !canRegister}>
            {busy ? <><Spin/> Registering…</> : canRegister ? 'Register on Blockchain' : 'Verify email first ↑'}
          </button>
        </form>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  RootGA Dashboard                                                  */
/* ══════════════════════════════════════════════════════════════════ */
function RootGAPage({ signer, address, provider }) {
  const [allUsers,   setAllUsers]   = useState([])
  const [issuers,    setIssuers]    = useState([])
  const [lgAddr,     setLgAddr]     = useState('')
  const [showManual, setShowManual] = useState(false)
  const [busy,       setBusy]       = useState({})
  const [loading,    setLoading]    = useState(true)
  const [err,  setErr]  = useState('')
  const [ok,   setOk]   = useState('')

  async function load() {
    console.log("MF load() start")
    setLoading(true)
    try {
      const trustC = new ethers.Contract(ADDR.trust, ABI.trust, provider)
      const didC   = new ethers.Contract(ADDR.did,   ABI.did,   provider)

      // ── Enumerate authorized LGs directly from TrustRegistry ───────
      const count = await trustC.getIssuerCount()
      const issuerList = []
      for (let i = 0; i < Number(count); i++) {
        try {
          const addr = await trustC.getIssuerAt(i)
          issuerList.push({
            address: addr,
            role: 'LocalGovt',
            company: displayName(addr),
          })
        } catch(e) { console.error("getCredential error:", e.message) }
      }
      setIssuers(issuerList)

      // ── Load non-LG registered users (candidates for authorization) ─
      const issuerSet = new Set(issuerList.map(lg => lg.address.toLowerCase()))
      const all = await loadAllRegistered(provider)
      setAllUsers(all.filter(u => !issuerSet.has(u.address.toLowerCase())))
    } catch(e) { console.error('RootGA load error:', e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function authorize(targetAddr) {
    const key = targetAddr.toLowerCase()
    setBusy(b=>({...b, [key]:true})); setErr(''); setOk('')
    try {
      const addr = targetAddr.trim()
      if (!ethers.isAddress(addr)) throw new Error('Invalid wallet address.')
      // Check if already authorized
      const trustC = new ethers.Contract(ADDR.trust, ABI.trust, provider)
      const alreadyAuth = await trustC.isAuthorizedIssuer(addr)
      if (alreadyAuth) {
        setErr(`❌ This wallet is already authorized as Local Government.`)
        setBusy(b=>({...b, [key]:false})); return
      }
      const C  = getC(signer)
      const tx = await C.trust.authorizeIssuer(addr, 'LocalGovt')
      setOk('Confirming…'); await tx.wait()
      setOk(`✅ ${displayName(addr)} is now authorized as Local Government!`)
      setLgAddr(''); load()
    } catch(e) { setErr(errMsg(e)) }
    setBusy(b=>({...b, [key]:false}))
  }

  return (
    <div className="page">
      <h2 className="page-title">🏛️ Root Governance Authority</h2>
      {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
      {ok  && <Alert type="success" onClose={()=>setOk('')}>{ok}</Alert>}

      <div className="cards-row">
        <div className="card flex-2">
          <div className="card-title">Authorize as Local Government</div>
          <div className="card-sub">Registered companies below are waiting for LG authorization. Click "Make LG" to grant them credential-issuing power.</div>

          {loading
            ? <div className="empty-state"><Spin size={20}/> Loading registered users…</div>
            : allUsers.length === 0
              ? <div className="empty-state" style={{flexDirection:'column', gap:4}}>
                  <span>No unregistered candidates yet</span>
                  <span style={{fontSize:'.75rem'}}>Users appear here after they register a DID on the blockchain</span>
                </div>
              : allUsers.map((u, i) => (
                <div key={i} className="candidate-row">
                  <div style={{display:'flex', alignItems:'center', gap:12}}>
                    <div className="account-avatar" style={{width:36, height:36, fontSize:'.9rem', flexShrink:0}}>
                      {(u.company || u.address)[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{fontWeight:600, fontSize:'.9rem'}}>{u.company}</div>
                      <div className="addr-text">{u.address}</div>
                    </div>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    {u.role && <Badge role={u.role}/>}
                    <button className="btn btn-success btn-sm"
                      onClick={()=>authorize(u.address)}
                      disabled={busy[u.address.toLowerCase()]}>
                      {busy[u.address.toLowerCase()] ? <Spin/> : '✅ Make LG'}
                    </button>
                  </div>
                </div>
              ))
          }

          <div style={{marginTop:16, borderTop:'1px solid #f1f5f9', paddingTop:14}}>
            <button className="btn btn-outline btn-sm" onClick={()=>setShowManual(m=>!m)} style={{marginBottom:10}}>
              {showManual ? '▲ Hide manual entry' : '▼ Enter address manually'}
            </button>
            {showManual && (
              <div style={{display:'flex', gap:8}}>
                <input className="form-input" placeholder="Wallet address: 0x…" value={lgAddr}
                  onChange={e=>setLgAddr(e.target.value)} style={{flex:1}} />
                <button className="btn btn-success" onClick={()=>authorize(lgAddr)}
                  disabled={busy[lgAddr?.toLowerCase()]||!lgAddr?.trim()}>
                  {busy[lgAddr?.toLowerCase()] ? <Spin/> : 'Authorize'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header-row">
            <div className="card-title">Active Local Governments</div>
            <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>{loading?<Spin/>:'↻'}</button>
          </div>
          <div style={{height:6}}/>
          {loading
            ? <div className="empty-state"><Spin size={20}/> Loading…</div>
            : issuers.length === 0
              ? <div className="empty-state">No authorized issuers yet</div>
              : issuers.map((lg,i) => (
                <div key={i} className="issuer-row">
                  <div style={{display:'flex', alignItems:'center', gap:10}}>
                    <div className="account-avatar" style={{width:34, height:34, fontSize:'.85rem', flexShrink:0, background:'#6d28d9'}}>
                      {(lg.company || lg.address)[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{fontWeight:600}}>{lg.company}</div>
                      <div className="addr-text">{short(lg.address)}</div>
                    </div>
                  </div>
                  <Badge role="LocalGovt"/>
                </div>
              ))
          }
        </div>
      </div>
      <ProductSearch provider={provider}/>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Local Government Dashboard                                        */
/* ══════════════════════════════════════════════════════════════════ */
function LocalGovtPage({ signer, address, provider, onLogout }) {
  const [actors,      setActors]  = useState({ Manufacturer:[], Distributor:[], Retailer:[] })
  const [holder,      setHolder]  = useState('')
  const [credType,    setCredType]= useState('ManufacturingLicense')
  const [days,        setDays]    = useState('365')
  const [issuedCreds, setIC]      = useState([])
  const [busy,        setBusy]    = useState(false)
  const [loading,     setLoading] = useState(true)
  const [lgDid,       setLgDid]   = useState(null)   // null=checking, false=none, true=active
  const [regBusy,     setRegBusy] = useState(false)
  const [err,  setErr]  = useState('')
  const [ok,   setOk]   = useState('')

  async function load() {
    console.log("MF load() start")
    setLoading(true)
    try {
      // Check LG DID and load actors in parallel
      const didC = new ethers.Contract(ADDR.did, ABI.did, provider)
      const [actorsResult, didInfo] = await Promise.allSettled([
        loadActors(provider),
        didC.getDID(address)
      ])
      if (actorsResult.status === 'fulfilled') setActors(actorsResult.value)
      if (didInfo.status === 'fulfilled') setLgDid(didInfo.value.active === true)
      else setLgDid(false)

      // Load issued credentials — scan all blocks from genesis
      const credC  = new ethers.Contract(ADDR.cred, ABI.cred, provider)
      const latest = await provider.getBlockNumber()
      const from   = Math.max(0, latest - 10000)
      const logs   = await chunkedLogs(credC, credC.filters.CredentialIssued(), from, latest)
      const creds  = []
      console.log("LG cred logs found:", logs.length)
      for (const log of [...logs].reverse()) {
        try {
          const c = await credC.getCredential(log.args.credentialId)
          creds.push({ id: log.args.credentialId, holder: c.holder, type: c.credType, expires: c.expiresAt, revoked: c.revoked })
        } catch(e) { console.error("getCredential error:", e.message) }
      }
      setIC(creds)
    } catch(e) { console.error('LG load error', e) }
    setLoading(false)
  }

  async function registerDID() {
    setRegBusy(true); setErr(''); setOk('')
    try {
      const C  = getC(signer)
      const tx = await C.did.registerDID('LocalGovt')
      setOk('Registering DID on blockchain…'); await tx.wait()
      setOk('✅ DID registered! You can now issue credentials.')
      setLgDid(true)
    } catch(e) { setErr(errMsg(e)) }
    setRegBusy(false)
  }

  useEffect(() => { load() }, [])

  async function issue(e) {
    e.preventDefault(); setErr(''); setOk(''); setBusy(true)
    try {
      if (!ethers.isAddress(holder.trim())) throw new Error('Please enter a valid wallet address.')
      const addr   = holder.trim()
      const didC   = new ethers.Contract(ADDR.did,  ABI.did,  provider)
      const credC  = new ethers.Contract(ADDR.cred, ABI.cred, provider)

      // Check holder has a registered active DID
      let holderDid
      try { holderDid = await didC.getDID(addr) } catch {}
      if (!holderDid || !holderDid.active) {
        setErr(`❌ This wallet has not registered a DID. They must register their DID before receiving credentials.`)
        setBusy(false); return
      }

      // Check for any existing active credential — one credential per wallet
      try {
        const hasActiveCred = await credC.isCredentialValid(addr)
        if (hasActiveCred) {
          setErr(`❌ ${displayName(addr)} already has an active credential. Revoke it first before issuing a new one.`)
          setBusy(false); return
        }
      } catch(dupErr) { console.error('Credential check failed:', dupErr) }

      const expires = Math.floor(Date.now()/1000) + Number(days)*86400
      const C       = getC(signer)
      const tx      = await C.cred.issueCredential(addr, credType, expires)
      setOk('Confirming on blockchain…'); await tx.wait()
      setOk(`✅ Credential issued to ${displayName(addr)}!`)
      setHolder(''); load()
    } catch(e) { setErr(e.message?.includes('valid wallet') ? e.message : errMsg(e)) }
    setBusy(false)
  }

  async function revoke(credId) {
    setBusy(true); setErr(''); setOk('')
    try {
      const C  = getC(signer)
      const tx = await C.cred.revokeCredential(credId)
      setOk('Revoking…'); await tx.wait()
      setOk('Credential revoked.'); load()
    } catch(e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  const allActors = [...actors.Manufacturer, ...actors.Distributor, ...actors.Retailer]

  return (
    <div className="page">
      <h2 className="page-title">🏛️ Local Government</h2>

      {/* DID registration banner */}
      {lgDid === false && (
        <div className="did-banner">
          <span>⚠️ <strong>Your DID is not registered.</strong> You must register your DID before you can issue credentials.</span>
          <button className="btn btn-warning btn-sm" onClick={registerDID} disabled={regBusy}>
            {regBusy ? <><Spin/> Registering…</> : '🪪 Register DID'}
          </button>
        </div>
      )}
      {lgDid === true && (
        <div className="did-banner did-ok">✅ DID registered — you can issue credentials.</div>
      )}

      <div className="cards-row">
        <div className="card">
          <div className="card-title">Issue Credential</div>
          <div className="card-sub">Grant a company the right to participate in the supply chain.</div>
          {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
          {ok  && <Alert type="success" onClose={()=>setOk('')}>{ok}</Alert>}
          <form onSubmit={issue}>
            <div className="form-group">
              <label className="form-label">Company</label>
              {allActors.length > 0 && (
                <select className="form-select" style={{marginBottom:8}} value={holder} onChange={e=>setHolder(e.target.value)}>
                  <option value="">— Select registered company —</option>
                  {allActors.map((a,i) => <option key={i} value={a.address}>{a.company}</option>)}
                </select>
              )}
              <input className="form-input" placeholder="Or paste wallet address: 0x…" value={holder}
                onChange={e=>setHolder(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Credential Type</label>
              <select className="form-select" value={credType} onChange={e=>setCredType(e.target.value)}>
                <option value="ManufacturingLicense">Manufacturing License</option>
                <option value="TradeLicense">Trade License</option>
                <option value="RetailLicense">Retail License</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Valid For (days)</label>
              <input className="form-input" type="number" value={days}
                onChange={e=>setDays(e.target.value)} min="1" max="3650"/>
            </div>
            <button className="btn btn-success" style={{width:'100%'}} type="submit" disabled={busy||!holder.trim()}>
              {busy ? <><Spin/> Issuing…</> : '📜 Issue Credential'}
            </button>
          </form>
        </div>
        <div className="card">
          <div className="card-header-row">
            <div className="card-title">Issued Credentials</div>
            <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>{loading?<Spin/>:'↻'}</button>
          </div>
          <div style={{height:6}}/>
          {loading
            ? <div className="empty-state"><Spin size={20}/> Loading…</div>
            : issuedCreds.length===0
              ? <div className="empty-state">No credentials issued yet</div>
              : issuedCreds.map((c,i) => {
                const icons = { ManufacturingLicense:'🏭', TradeLicense:'🤝', DistributionLicense:'🚚', RetailLicense:'🏪', GovtAuthority:'🏛️' }
                const icon  = icons[c.type] || '📜'
                return (
                  <div key={i} className={`cred-card${c.revoked?' revoked':''}`}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:4}}>
                          <span style={{fontSize:'1.2rem'}}>{icon}</span>
                          <div className="cred-type">{c.type.replace(/([A-Z])/g,' $1').trim()}</div>
                        </div>
                        <div className="cred-meta">Company: <strong>{displayName(c.holder)}</strong></div>
                        <div className="cred-meta" style={{fontSize:'11px', opacity:.7, marginTop:2, wordBreak:'break-all'}}>{c.holder}</div>
                        <div className="cred-meta">Expires: {fmtDate(c.expires)}</div>
                      </div>
                      <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4}}>
                        {c.revoked
                          ? <span className="revoked-tag">REVOKED</span>
                          : <button className="btn btn-danger btn-sm" onClick={()=>revoke(c.id)} disabled={busy}>Revoke</button>
                        }
                      </div>
                    </div>
                  </div>
                )
              })
          }
        </div>
      </div>
      <EmailSettings roleKey="LG" />
      <ProductSearch provider={provider}/>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Manufacturer Dashboard                                            */
/* ══════════════════════════════════════════════════════════════════ */
const getHidden = (role, addr) => { try { return new Set(JSON.parse(localStorage.getItem(`sc_hidden_${role}_${addr?.toLowerCase()}`) || '[]')) } catch { return new Set() } }
const saveHidden = (role, addr, set) => { try { localStorage.setItem(`sc_hidden_${role}_${addr?.toLowerCase()}`, JSON.stringify([...set])) } catch {} }

function ManufacturerPage({ signer, address, provider, onLogout }) {
  const [products,  setProducts]  = useState([])
  const [actors,    setActors]    = useState({ Distributor:[] })
  const [hasCred,   setHasCred]   = useState(null)
  const [newName,   setNewName]   = useState('')
  const [shipForm,  setShipForm]  = useState({})
  const [qrProduct, setQrProduct] = useState(null)  // { id, name } for QR modal
  const [hidden,    setHidden]    = useState(() => getHidden('MF', address))
  const [showHidden,setShowHidden]= useState(false)
  const [busy,      setBusy]      = useState({})
  const [loading,   setLoading]   = useState(true)
  const [err,  setErr]  = useState('')
  const [ok,   setOk]   = useState('')

  async function load() {
    setLoading(true)
    try {
      const ptC  = new ethers.Contract(ADDR.pt,  ABI.pt,  provider)
      const didC = new ethers.Contract(ADDR.did, ABI.did, provider)

      // Use getManufacturerProducts — reliable, no block-window limit
      const ids   = await ptC.getManufacturerProducts(address)
      const prods = []
      for (const id of [...ids].reverse()) {
        try {
          const p = await ptC.getProduct(id)
          if (p.id.toString() === '0') continue
          const statusNum   = Number(p.status)
          const holderAddr  = p.currentHolder
          const pendingAddr = p.pendingRecipient

          // Resolve location label from DID registry
          let locationLabel = ''
          try {
            if (statusNum === 1 && pendingAddr !== ethers.ZeroAddress) {
              const doc = await didC.getDID(pendingAddr)
              locationLabel = doc.active && doc.role?.trim() ? `→ ${doc.role.trim()}` : '→ …'
            } else if (statusNum === 0 && holderAddr.toLowerCase() !== address.toLowerCase()) {
              const doc = await didC.getDID(holderAddr)
              locationLabel = doc.active && doc.role?.trim() ? `at ${doc.role.trim()}` : 'at partner'
            }
          } catch {}

          prods.push({ id, name: p.name, holder: holderAddr, pendingRecipient: pendingAddr, status: p.status, locationLabel })
        } catch(e) { console.error('getProduct error:', e.message) }
      }
      setProducts(prods)
      const [actors, cred] = await Promise.all([loadActors(provider), hasValidCred(address, provider)])
      setActors(actors)
      setHasCred(cred)
    } catch(e) { console.error('Manufacturer load error:', e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function createProduct(e) {
    e.preventDefault(); setErr(''); setOk(''); setBusy(b=>({...b, create:true}))
    try {
      if (!newName.trim()) throw new Error('Please enter a product name.')
      const C       = getC(signer)
      const tx      = await C.pt.createProduct(newName.trim(), 'ipfs://pending')
      setOk('Creating product on blockchain…')
      const receipt = await tx.wait()
      let pid = null
      for (const log of receipt.logs) {
        try {
          const p = C.pt.interface.parseLog(log)
          if (p?.name === 'ProductCreated') { pid = p.args.id; break }
        } catch(e) { console.error("getCredential error:", e.message) }
      }
      const name = newName.trim()
      setOk(`✅ "${name}" created! Product ID: #${pid?.toString() || '?'}`)
      setNewName('')
      if (pid) setQrProduct({ id: pid, name })
      load()
    } catch(e) { setErr(e.message?.includes('Please enter') ? e.message : errMsg(e)) }
    setBusy(b=>({...b, create:false}))
  }

  async function shipProduct(pid) {
    const key  = pid.toString()
    const form = shipForm[key] || {}
    setErr(''); setOk(''); setBusy(b=>({...b, ['ship_'+key]:true}))
    try {
      if (!ethers.isAddress(form.recipAddr||'')) throw new Error('Please select a distributor.')
      const C  = getC(signer)
      const tx = await C.pt.shipTo(pid, form.recipAddr)
      setOk('Shipping…'); await tx.wait()
      setShipForm(s=>({...s, [key]: {}}))
      setOk(`🚚 Shipped to ${displayName(form.recipAddr)}! They will see it in their incoming shipments.`)
      load()
    } catch(e) { setErr(e.message?.includes('select') ? e.message : errMsg(e)) }
    setBusy(b=>({...b, ['ship_'+key]:false}))
  }

  async function cancelShipmentMF(pid) {
    const key = pid.toString()
    setErr(''); setOk(''); setBusy(b=>({...b, ['cancel_'+key]:true}))
    try {
      const C  = getC(signer)
      const tx = await C.pt.cancelShipment(pid)
      setOk('Cancelling shipment…'); await tx.wait()
      setOk('✅ Shipment cancelled — product returned to In Stock.'); load()
    } catch(e) { setErr(errMsg(e)) }
    setBusy(b=>({...b, ['cancel_'+key]:false}))
  }

  async function forceRecallMF(pid) {
    const key = pid.toString()
    setErr(''); setOk(''); setBusy(b=>({...b, ['recall_'+key]:true}))
    try {
      const C  = getC(signer)
      const tx = await C.pt.forceRecall(pid)
      setOk('Force recalling product…'); await tx.wait()
      setOk('✅ Product force recalled — back in your inventory.'); load()
    } catch(e) { setErr(errMsg(e)) }
    setBusy(b=>({...b, ['recall_'+key]:false}))
  }

  function toggleHide(pid) {
    const key = pid.toString()
    setHidden(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      saveHidden('MF', address, next)
      return next
    })
  }

  const setField = (id, field, val) =>
    setShipForm(s=>({...s, [id.toString()]: {...(s[id.toString()]||{}), [field]:val}}))

  const myProds    = products.filter(p => !hidden.has(p.id.toString()) && p.holder.toLowerCase()===address.toLowerCase() && Number(p.status)===0)
  const inTransit  = products.filter(p => !hidden.has(p.id.toString()) && Number(p.status)===1)
  const atPartner  = products.filter(p => !hidden.has(p.id.toString()) && p.holder.toLowerCase()!==address.toLowerCase() && Number(p.status)===0)
  const delivered  = products.filter(p => !hidden.has(p.id.toString()) && Number(p.status)===2)
  const cancelled  = products.filter(p => !hidden.has(p.id.toString()) && Number(p.status)===3)
  const hiddenProds= products.filter(p =>  hidden.has(p.id.toString()))

  return (
    <div className="page">
      <h2 className="page-title">🏭 Manufacturer Dashboard</h2>
      {hasCred === false && <Alert type="warning">No active credential found. Contact your Local Government to get one before creating products.</Alert>}

      {/* QR Code Modal */}
      {qrProduct && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999}} onClick={()=>setQrProduct(null)}>
          <div style={{background:'#fff', borderRadius:16, padding:32, maxWidth:340, width:'90%', textAlign:'center'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:'1.1rem', fontWeight:800, marginBottom:4}}>Product QR Code</div>
            <div style={{fontSize:'.85rem', color:'#64748b', marginBottom:16}}>{qrProduct.name} · ID #{qrProduct.id?.toString()}</div>
            <QRCodeImg url={verifyUrl(qrProduct.id?.toString())} size={200}/>
            <div style={{marginTop:12, fontSize:'.75rem', color:'#94a3b8', wordBreak:'break-all'}}>{verifyUrl(qrProduct.id?.toString())}</div>
            <button className="btn btn-outline" style={{marginTop:16, width:'100%'}} onClick={()=>setQrProduct(null)}>Close</button>
          </div>
        </div>
      )}

      <div className="cards-row">
        <div className="card">
          <div className="card-title">Create New Product</div>
          <div className="card-sub">Register a product on the blockchain. Your credential is verified automatically.</div>
          {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
          {ok  && <Alert type="success" onClose={()=>setOk('')}>{ok}</Alert>}
          <form onSubmit={createProduct}>
            <div className="form-group">
              <label className="form-label">Product Name</label>
              <input className="form-input" placeholder="e.g. Widget Model X" value={newName}
                onChange={e=>setNewName(e.target.value)}/>
            </div>
            <button className="btn btn-primary" style={{width:'100%'}} type="submit" disabled={busy.create}>
              {busy.create ? <><Spin/> Creating…</> : '📦 Create Product'}
            </button>
          </form>
        </div>

        <div className="card flex-2">
          <div className="card-header-row">
            <div className="card-title">My Inventory</div>
            <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>{loading?<Spin/>:'↻ Refresh'}</button>
          </div>
          <div style={{height:6}}/>
          {loading
            ? <div className="empty-state"><Spin size={20}/> Loading…</div>
            : myProds.length===0 && inTransit.length===0 && atPartner.length===0 && delivered.length===0 && cancelled.length===0
              ? <div className="empty-state">No products yet — create your first one</div>
              : <>
                {myProds.map((p,i) => {
                  const key = p.id.toString()
                  return (
                    <div key={i} className="inventory-item">
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                        <div>
                          <strong style={{fontSize:'.95rem'}}>{p.name}</strong>
                          <span className="cred-type-tag" style={{marginLeft:8}}>ID #{key}</span>
                        </div>
                        <div style={{display:'flex', gap:6, alignItems:'center'}}>
                          <button className="btn btn-outline btn-sm" title="Archive" onClick={()=>toggleHide(p.id)}>🗂</button>
                          <button className="btn btn-outline btn-sm" onClick={()=>setQrProduct({id:p.id, name:p.name})}>🔳 QR</button>
                          <span className="status-badge status-stock">In Stock</span>
                        </div>
                      </div>
                      <div className="ship-panel">
                        <div className="ship-panel-title">🚚 Ship to Distributor</div>
                        <div className="ship-row">
                          <select className="form-select form-select-sm" style={{flex:1, minWidth:140}}
                            value={shipForm[key]?.recipAddr||''}
                            onChange={e=>setField(p.id,'recipAddr',e.target.value)}>
                            <option value="">Select distributor…</option>
                            {actors.Distributor.map((d,j) => <option key={j} value={d.address}>{d.company}</option>)}
                          </select>
                          <button className="btn btn-success btn-sm"
                            onClick={()=>shipProduct(p.id)} disabled={busy['ship_'+key]}>
                            {busy['ship_'+key] ? <Spin/> : 'Ship →'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {inTransit.map((p,i) => {
                  const key = p.id.toString()
                  return (
                    <div key={i} className="product-row">
                      <div>
                        <div className="product-name">{p.name}</div>
                        <div style={{fontSize:'.75rem', color:'#94a3b8', marginTop:2}}>
                          ID #{key} · In Transit {p.locationLabel}
                        </div>
                      </div>
                      <div style={{display:'flex', gap:6, alignItems:'center'}}>
                        <button className="btn btn-danger btn-sm"
                          onClick={()=>cancelShipmentMF(p.id)} disabled={busy['cancel_'+key]}
                          title="Cancel shipment if recipient's credential was revoked">
                          {busy['cancel_'+key] ? <Spin/> : '✕ Cancel'}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={()=>forceRecallMF(p.id)} disabled={busy['recall_'+key]}>
                          {busy['recall_'+key] ? <Spin/> : '⬅ Force Recall'}
                        </button>
                        <span className="status-badge status-transit">🚚 In Transit</span>
                      </div>
                    </div>
                  )
                })}
                {atPartner.map((p,i) => {
                  const key = p.id.toString()
                  return (
                  <div key={i} className="product-row">
                    <div>
                      <div className="product-name">{p.name}</div>
                      <div style={{fontSize:'.75rem', color:'#94a3b8', marginTop:2}}>
                        ID #{p.id.toString()} · {p.locationLabel || 'at partner'}
                      </div>
                    </div>
                    <div style={{display:'flex', gap:6, alignItems:'center'}}>
                      <button className="btn btn-danger btn-sm" onClick={()=>forceRecallMF(p.id)} disabled={busy['recall_'+key]}>
                        {busy['recall_'+key] ? <Spin/> : '⬅ Force Recall'}
                      </button>
                      <span className="status-badge" style={{background:'rgba(59,130,246,.15)', color:'#93c5fd', border:'1px solid rgba(59,130,246,.3)'}}>
                        📦 At {p.locationLabel?.replace('at ','')||'Partner'}
                      </span>
                    </div>
                  </div>
                )})}
                {delivered.map((p,i) => {
                  const key = p.id.toString()
                  return (
                  <div key={i} className="product-row">
                    <div>
                      <div className="product-name">{p.name}</div>
                      <div style={{fontSize:'.75rem', color:'#94a3b8', marginTop:2}}>ID #{p.id.toString()} · chain complete</div>
                    </div>
                    <div style={{display:'flex', gap:6, alignItems:'center'}}>
                      <button className="btn btn-danger btn-sm" onClick={()=>forceRecallMF(p.id)} disabled={busy['recall_'+key]}>
                        {busy['recall_'+key] ? <Spin/> : '⬅ Force Recall'}
                      </button>
                      <button className="btn btn-outline btn-sm" title="Archive" onClick={()=>toggleHide(p.id)}>🗂</button>
                      <button className="btn btn-outline btn-sm" onClick={()=>setQrProduct({id:p.id, name:p.name})}>🔳 QR</button>
                      <span className="status-badge status-done">✅ Delivered</span>
                    </div>
                  </div>
                )})}

                {cancelled.map((p,i) => (
                  <div key={i} className="product-row" style={{opacity:.7}}>
                    <div>
                      <div className="product-name">{p.name}</div>
                      <div style={{fontSize:'.75rem', color:'#94a3b8', marginTop:2}}>ID #{p.id.toString()}</div>
                    </div>
                    <div style={{display:'flex', gap:6, alignItems:'center'}}>
                      <button className="btn btn-outline btn-sm" title="Archive" onClick={()=>toggleHide(p.id)}>🗂</button>
                      <span className="status-badge status-cancelled">🚫 Cancelled</span>
                    </div>
                  </div>
                ))}
                {hiddenProds.length > 0 && (
                  <div style={{marginTop:12, borderTop:'1px solid #f1f5f9', paddingTop:10}}>
                    <button className="btn btn-outline btn-sm" onClick={()=>setShowHidden(v=>!v)}>
                      {showHidden ? '▲ Hide archived' : `▼ Show archived (${hiddenProds.length})`}
                    </button>
                    {showHidden && hiddenProds.map((p,i) => (
                      <div key={i} className="product-row" style={{opacity:.5}}>
                        <div>
                          <div className="product-name">{p.name}</div>
                          <div style={{fontSize:'.75rem', color:'#94a3b8', marginTop:2}}>ID #{p.id.toString()}</div>
                        </div>
                        <button className="btn btn-outline btn-sm" onClick={()=>toggleHide(p.id)}>↩ Restore</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
          }
        </div>
      </div>
      <EmailSettings roleKey="MF" />
      <ProductSearch provider={provider}/>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Distributor Dashboard                                             */
/* ══════════════════════════════════════════════════════════════════ */
function DistributorPage({ signer, address, provider, onLogout }) {
  const [pending,    setPending]  = useState([])
  const [inventory,  setInv]      = useState([])
  const [actors,     setActors]   = useState({ Retailer:[] })
  const [hasCred,    setHasCred]  = useState(null)
  const [shipForm,   setShipForm] = useState({})
  const [hidden,     setHidden]   = useState(() => getHidden('DT', address))
  const [showHidden, setShowHidden]= useState(false)
  const [busy,       setBusy]     = useState({})
  const [loading,    setLoading]  = useState(true)
  const [err,  setErr]  = useState('')
  const [ok,   setOk]   = useState('')

  async function load() {
    setLoading(true)
    try {
      const ptC    = new ethers.Contract(ADDR.pt, ABI.pt, provider)
      const latest = await provider.getBlockNumber()
      const from   = Math.max(0, latest - 2000)

      // Inventory: use getHolderProducts — reliable, no block-window limit
      const holderIds = await ptC.getHolderProducts(address)
      const inv = []
      for (const id of [...holderIds].reverse()) {
        try {
          const p = await ptC.getProduct(id)
          if (p.id.toString() === '0') continue
          if (p.currentHolder.toLowerCase() === address.toLowerCase())
            inv.push({ id, name: p.name, status: p.status })
        } catch(e) { console.error('getProduct error:', e.message) }
      }
      setInv(inv)

      // Incoming: use events (pending shipments not yet confirmed)
      const shippedLogs = await chunkedLogs(ptC, ptC.filters.ProductShipped(null, null, address), from, latest)
      const pend = [], seen = new Set()
      for (const log of [...shippedLogs].reverse()) {
        const id = log.args.id.toString()
        if (seen.has(id)) continue; seen.add(id)
        try {
          const p = await ptC.getProduct(log.args.id)
          if (p.id.toString() === '0') continue
          if (p.pendingRecipient.toLowerCase() === address.toLowerCase())
            pend.push({ id: log.args.id, name: p.name, from: log.args.from })
        } catch(e) { console.error('getProduct error:', e.message) }
      }
      setPending(pend)

      const a = await loadActors(provider)
      setActors(a)
      const cred = await hasValidCred(address, provider)
      setHasCred(cred)
    } catch(e) { console.error('Distributor load error:', e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function confirmProduct(pid) {
    const key = pid.toString()
    setErr(''); setOk(''); setBusy(b=>({...b, ['confirm_'+key]:true}))
    try {
      const C  = getC(signer)
      const tx = await C.pt.confirmReceipt(pid)
      setOk('Confirming receipt…'); await tx.wait()
      setOk('✅ Product received and added to your inventory!'); load()
    } catch(e) { setErr(errMsg(e)) }
    setBusy(b=>({...b, ['confirm_'+key]:false}))
  }

  async function shipProduct(pid) {
    const key = pid.toString(), form = shipForm[key]||{}
    setErr(''); setOk(''); setBusy(b=>({...b, ['ship_'+key]:true}))
    try {
      if (!ethers.isAddress(form.recipAddr||'')) throw new Error('Please select a retailer.')
      const C  = getC(signer)
      const tx = await C.pt.shipTo(pid, form.recipAddr)
      setOk('Shipping…'); await tx.wait()
      setShipForm(s=>({...s, [key]: {}}))
      setOk(`🚚 Shipped to ${displayName(form.recipAddr)}!`); load()
    } catch(e) { setErr(e.message?.includes('select') ? e.message : errMsg(e)) }
    setBusy(b=>({...b, ['ship_'+key]:false}))
  }

  async function cancelShipmentDT(pid) {
    const key = pid.toString()
    setErr(''); setOk(''); setBusy(b=>({...b, ['cancel_'+key]:true}))
    try {
      const C  = getC(signer)
      const tx = await C.pt.cancelShipment(pid)
      setOk('Cancelling shipment…'); await tx.wait()
      setOk('✅ Shipment cancelled — product returned to In Stock.'); load()
    } catch(e) { setErr(errMsg(e)) }
    setBusy(b=>({...b, ['cancel_'+key]:false}))
  }

  async function forceRecallDT(pid) {
    const key = pid.toString()
    setErr(''); setOk(''); setBusy(b=>({...b, ['recall_'+key]:true}))
    try {
      const C  = getC(signer)
      const tx = await C.pt.forceRecall(pid)
      setOk('Force recalling product from retailer…'); await tx.wait()
      setOk('✅ Product force recalled — back in your inventory.'); load()
    } catch(e) { setErr(errMsg(e)) }
    setBusy(b=>({...b, ['recall_'+key]:false}))
  }

  function toggleHideDT(pid) {
    const key = pid.toString()
    setHidden(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      saveHidden('DT', address, next)
      return next
    })
  }

  const setField = (id, field, val) =>
    setShipForm(s=>({...s, [id.toString()]: {...(s[id.toString()]||{}), [field]:val}}))

  return (
    <div className="page">
      <h2 className="page-title">🚚 Distributor Dashboard</h2>
      {hasCred === false && <Alert type="warning">No active credential found. Contact your Local Government to get one before accepting or shipping products.</Alert>}
      {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
      {ok  && <Alert type="success" onClose={()=>setOk('')}>{ok}</Alert>}

      <div className="card">
        <div className="card-header-row">
          <div className="card-title">📬 Incoming Shipments</div>
          <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>{loading?<Spin/>:'↻ Refresh'}</button>
        </div>
        <div className="card-sub">Products shipped to you — click Accept to confirm receipt and add to inventory.</div>
        {loading
          ? <div className="empty-state"><Spin size={20}/> Loading…</div>
          : pending.length===0
            ? <div className="empty-state">No incoming shipments</div>
            : pending.map((p,i) => {
              const key = p.id.toString()
              return (
                <div key={i} className="transfer-card">
                  <div className="transfer-info">
                    <strong>{p.name}</strong>
                    <div className="transfer-from">From: {displayName(p.from)} · ID #{key}</div>
                  </div>
                  <button className="btn btn-success btn-sm" onClick={()=>confirmProduct(p.id)} disabled={busy['confirm_'+key]}>
                    {busy['confirm_'+key] ? <Spin/> : 'Accept ✓'}
                  </button>
                </div>
              )
            })
        }
      </div>

      <div className="card mt-4">
        <div className="card-header-row">
          <div className="card-title">📦 My Inventory</div>
          <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>{loading?<Spin/>:'↻'}</button>
        </div>
        <div style={{height:6}}/>
        {loading
          ? <div className="empty-state"><Spin size={20}/> Loading…</div>
          : inventory.filter(p=>!hidden.has(p.id.toString())).length===0
            ? <div className="empty-state">No products in inventory yet</div>
            : <>
              {inventory.filter(p=>!hidden.has(p.id.toString())).map((p,i) => {
                const key = p.id.toString()
                const statusNum = Number(p.status)
                return (
                  <div key={i} className="inventory-item verified" style={statusNum===3?{opacity:.7}:{}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: statusNum===0 ? 10 : 0}}>
                      <div>
                        <strong style={{fontSize:'.95rem'}}>{p.name}</strong>
                        <span className="cred-type-tag" style={{marginLeft:8}}>ID #{key}</span>
                      </div>
                      <div style={{display:'flex', gap:6, alignItems:'center'}}>
                        {statusNum===1 && (
                          <button className="btn btn-danger btn-sm"
                            onClick={()=>cancelShipmentDT(p.id)} disabled={busy['cancel_'+key]}
                            title="Cancel shipment if recipient's credential was revoked">
                            {busy['cancel_'+key] ? <Spin/> : '✕ Cancel'}
                          </button>
                        )}
                        {statusNum===2 && (
                          <button className="btn btn-danger btn-sm"
                            onClick={()=>forceRecallDT(p.id)} disabled={busy['recall_'+key]}
                            title="Force recall from retailer if their credential is revoked">
                            {busy['recall_'+key] ? <Spin/> : '⬅ Force Recall'}
                          </button>
                        )}
                        <button className="btn btn-outline btn-sm" title="Archive" onClick={()=>toggleHideDT(p.id)}>🗂</button>
                        {statusNum===0 && <span className="status-badge status-stock">In Stock</span>}
                        {statusNum===1 && <span className="status-badge status-transit">In Transit</span>}
                        {statusNum===2 && <span className="status-badge status-done">✅ Delivered</span>}
                        {statusNum===3 && <span className="status-badge status-cancelled">🚫 Cancelled</span>}
                      </div>
                    </div>
                    {statusNum===0 && <div className="ship-panel">
                      <div className="ship-panel-title">🚚 Ship to Retailer</div>
                      <div className="ship-row">
                        <select className="form-select form-select-sm" style={{flex:1, minWidth:140}}
                          value={shipForm[key]?.recipAddr||''}
                          onChange={e=>setField(p.id,'recipAddr',e.target.value)}>
                          <option value="">Select retailer…</option>
                          {actors.Retailer.map((r,j) => <option key={j} value={r.address}>{r.company}</option>)}
                        </select>
                        <button className="btn btn-success btn-sm"
                          onClick={()=>shipProduct(p.id)} disabled={busy['ship_'+key]}>
                          {busy['ship_'+key] ? <Spin/> : 'Ship →'}
                        </button>
                      </div>
                    </div>}
                  </div>
                )
              })}
              {inventory.filter(p=>hidden.has(p.id.toString())).length > 0 && (
                <div style={{marginTop:12, borderTop:'1px solid #f1f5f9', paddingTop:10}}>
                  <button className="btn btn-outline btn-sm" onClick={()=>setShowHidden(v=>!v)}>
                    {showHidden ? '▲ Hide archived' : `▼ Show archived (${inventory.filter(p=>hidden.has(p.id.toString())).length})`}
                  </button>
                  {showHidden && inventory.filter(p=>hidden.has(p.id.toString())).map((p,i) => (
                    <div key={i} className="product-row" style={{opacity:.5}}>
                      <div>
                        <div className="product-name">{p.name}</div>
                        <div style={{fontSize:'.75rem', color:'#94a3b8', marginTop:2}}>ID #{p.id.toString()}</div>
                      </div>
                      <button className="btn btn-outline btn-sm" onClick={()=>toggleHideDT(p.id)}>↩ Restore</button>
                    </div>
                  ))}
                </div>
              )}
            </>
        }
      </div>
      <EmailSettings roleKey="DT" />
      <ProductSearch provider={provider}/>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Retailer Dashboard                                                */
/* ══════════════════════════════════════════════════════════════════ */
function RetailerPage({ signer, address, provider, onLogout }) {
  const [pending,   setPending]  = useState([])
  const [inventory, setInv]      = useState([])
  const [hasCred,   setHasCred]  = useState(null)
  const [auditMap,  setAuditMap] = useState({})
  const [busy,      setBusy]     = useState({})
  const [loading,   setLoading]  = useState(true)
  const [err,  setErr]  = useState('')
  const [ok,   setOk]   = useState('')
  const [qrProduct, setQrProduct] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const ptC    = new ethers.Contract(ADDR.pt, ABI.pt, provider)
      const latest = await provider.getBlockNumber()
      const from   = Math.max(0, latest - 2000)

      // Inventory: use getHolderProducts — reliable, no block-window limit
      const holderIds = await ptC.getHolderProducts(address)
      const inv = []
      for (const id of [...holderIds].reverse()) {
        try {
          const p = await ptC.getProduct(id)
          if (p.id.toString() === '0') continue
          if (p.currentHolder.toLowerCase() === address.toLowerCase())
            inv.push({ id, name: p.name })
        } catch(e) { console.error('getProduct error:', e.message) }
      }
      setInv(inv)

      // Incoming: use events (pending shipments not yet confirmed)
      const shippedLogs = await chunkedLogs(ptC, ptC.filters.ProductShipped(null, null, address), from, latest)
      const pend = [], seen = new Set()
      for (const log of [...shippedLogs].reverse()) {
        const id = log.args.id.toString()
        if (seen.has(id)) continue; seen.add(id)
        try {
          const p = await ptC.getProduct(log.args.id)
          if (p.id.toString() === '0') continue
          if (p.pendingRecipient.toLowerCase() === address.toLowerCase())
            pend.push({ id: log.args.id, name: p.name, from: log.args.from })
        } catch(e) { console.error('getProduct error:', e.message) }
      }
      setPending(pend)
      const cred = await hasValidCred(address, provider)
      setHasCred(cred)
    } catch(e) { console.error('Retailer load error:', e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function confirmProduct(pid) {
    const key = pid.toString()
    setErr(''); setOk(''); setBusy(b=>({...b, ['confirm_'+key]:true}))
    try {
      const C  = getC(signer)
      const tx = await C.pt.confirmReceipt(pid)
      setOk('Confirming receipt…'); await tx.wait()
      setOk('✅ Product received!'); load()
    } catch(e) { setErr(errMsg(e)) }
    setBusy(b=>({...b, ['confirm_'+key]:false}))
  }

  async function verifyChain(pid) {
    const key = pid.toString()
    setBusy(b=>({...b, ['verify_'+key]:true}))
    try {
      const auditC = new ethers.Contract(ADDR.audit, ABI.audit, provider)
      const result = await auditC.auditProduct(BigInt(pid))
      setAuditMap(m=>({...m, [key]: result}))
    } catch(e) { setErr(errMsg(e)) }
    setBusy(b=>({...b, ['verify_'+key]:false}))
  }

  return (
    <div className="page">
      <h2 className="page-title">🏪 Retailer Dashboard</h2>
      {hasCred === false && <Alert type="warning">No active credential found. Contact your Local Government to get one before accepting products.</Alert>}
      {err && <Alert type="error" onClose={()=>setErr('')}>{err}</Alert>}
      {ok  && <Alert type="success" onClose={()=>setOk('')}>{ok}</Alert>}

      {/* QR Modal */}
      {qrProduct && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999}} onClick={()=>setQrProduct(null)}>
          <div style={{background:'#fff', borderRadius:16, padding:32, maxWidth:340, width:'90%', textAlign:'center'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:'1.1rem', fontWeight:800, marginBottom:4}}>Product QR Code</div>
            <div style={{fontSize:'.85rem', color:'#64748b', marginBottom:16}}>{qrProduct.name} · ID #{qrProduct.id?.toString()}</div>
            <QRCodeImg url={verifyUrl(qrProduct.id?.toString())} size={200}/>
            <div style={{marginTop:12, fontSize:'.75rem', color:'#94a3b8', wordBreak:'break-all'}}>{verifyUrl(qrProduct.id?.toString())}</div>
            <p style={{fontSize:'.82rem', color:'#64748b', marginTop:12}}>Share this QR code with customers to let them verify the product's complete supply chain.</p>
            <button className="btn btn-outline" style={{marginTop:12, width:'100%'}} onClick={()=>setQrProduct(null)}>Close</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header-row">
          <div className="card-title">📬 Incoming Shipments</div>
          <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>{loading?<Spin/>:'↻'}</button>
        </div>
        <div className="card-sub">Accept shipments from your distributor.</div>
        {loading
          ? <div className="empty-state"><Spin size={20}/> Loading…</div>
          : pending.length===0
            ? <div className="empty-state">No incoming shipments</div>
            : pending.map((p,i) => (
              <div key={i} className="transfer-card">
                <div className="transfer-info">
                  <strong>{p.name}</strong>
                  <div className="transfer-from">From: {displayName(p.from)} · ID #{p.id.toString()}</div>
                </div>
                <button className="btn btn-success btn-sm" onClick={()=>confirmProduct(p.id)} disabled={busy['confirm_'+p.id.toString()]}>
                  {busy['confirm_'+p.id.toString()] ? <Spin/> : 'Accept ✓'}
                </button>
              </div>
            ))
        }
      </div>

      <div className="card mt-4">
        <div className="card-header-row">
          <div className="card-title">🏪 My Inventory</div>
          <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>{loading?<Spin/>:'↻'}</button>
        </div>
        <div style={{height:6}}/>
        {loading
          ? <div className="empty-state"><Spin size={20}/> Loading…</div>
          : inventory.length===0
            ? <div className="empty-state">No products received yet</div>
            : inventory.map((p,i) => {
              const key    = p.id.toString()
              const audit  = auditMap[key]
              return (
                <div key={i} className="inventory-item verified">
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                    <div>
                      <strong style={{fontSize:'.95rem'}}>{p.name}</strong>
                      <div className="cred-meta" style={{marginTop:3}}>ID #{key}</div>
                    </div>
                    <div style={{display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end'}}>
                      {audit
                        ? audit.verified
                          ? <span style={{color:'#059669', fontWeight:700, fontSize:'.85rem'}}>✅ Chain Verified</span>
                          : <span style={{color:'#dc2626', fontSize:'.8rem'}}>⚠️ {audit.failReason}</span>
                        : null
                      }
                      <div style={{display:'flex', gap:6}}>
                        <button className="btn btn-outline btn-sm"
                          onClick={()=>verifyChain(key)} disabled={busy['verify_'+key]}>
                          {busy['verify_'+key] ? <Spin/> : '🔍 Verify Chain'}
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={()=>setQrProduct({id:p.id, name:p.name})}>
                          🔳 QR Code
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
        }
      </div>
      <EmailSettings roleKey="RT" />
      <ProductSearch provider={provider}/>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════ */
/*  APP ROOT                                                          */
/* ══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [provider, setProvider] = useState(null)
  const [signer,   setSigner]   = useState(null)
  const [address,  setAddress]  = useState(null)
  const [role,     setRole]     = useState(null)
  const [step,     setStep]     = useState('pick')

  // ── Inject global styles ──────────────────────────────────────
  // (Styles rendered at root level through portal-like approach)
  // ── Public verify route: ?verify=PRODUCT_ID ────────────────────
  const verifyId = new URLSearchParams(window.location.search).get('verify')
  if (verifyId) return <VerifyPage productId={verifyId}/>

  useEffect(() => {
    if (!window.ethereum) return
    const onChange = () => logout()
    window.ethereum.on('accountsChanged', onChange)
    return () => window.ethereum.removeListener('accountsChanged', onChange)
  }, [])

  function logout() {
    setProvider(null); setSigner(null); setAddress(null); setRole(null); setStep('pick')
  }

  async function onConnect(prov, sign, addr) {
    setProvider(prov); setSigner(sign); setAddress(addr)
    setStep(getPwHash(addr) ? 'login' : 'setpassword')
  }

  async function afterAuth() {
    setStep('detecting')
    const r = await detectRole(address, provider)
    setRole(r)
    setStep(r ? 'app' : 'register')
  }

  const navbar = <Navbar address={address} role={role} onLogout={logout}/>
  const styles = <Styles/>

  if (step === 'pick')
    return <>{styles}{navbar}<AccountPickerPage onConnect={onConnect}/></>

  if (step === 'setpassword')
    return <>{styles}{navbar}<SetPasswordPage address={address} onDone={afterAuth}/></>

  if (step === 'login')
    return <>{styles}{navbar}<PasswordLoginPage address={address} onDone={afterAuth} onSwitchWallet={logout}/></>

  if (step === 'detecting')
    return <>{styles}{navbar}
      <div className="center-wrap">
        <div className="login-card" style={{textAlign:'center'}}>
          <Spin size={36}/>
          <p style={{marginTop:18, color:'#64748b', fontSize:'.95rem'}}>Detecting your role on the blockchain…</p>
        </div>
      </div>
    </>

  if (step === 'register')
    return <>{styles}{navbar}<RegisterPage signer={signer} address={address} provider={provider} onDone={afterAuth}/></>

  return (
    <>
      {styles}
      {navbar}
      {role==='RootGA'       && <RootGAPage       signer={signer} address={address} provider={provider}/>}
      {role==='LocalGovt'    && <LocalGovtPage    signer={signer} address={address} provider={provider} onLogout={logout}/>}
      {role==='Manufacturer' && <ManufacturerPage signer={signer} address={address} provider={provider} onLogout={logout}/>}
      {role==='Distributor'  && <DistributorPage  signer={signer} address={address} provider={provider} onLogout={logout}/>}
      {role==='Retailer'     && <RetailerPage     signer={signer} address={address} provider={provider} onLogout={logout}/>}
    </>
  )
}

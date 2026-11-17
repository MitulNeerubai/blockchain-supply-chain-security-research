import { ethers } from 'ethers'

// DIDLab Secure IPFS - encrypt in the browser, upload the ciphertext, get a CID.
// Mirrors the portal at https://blockchain.didlab.org/ipfs
const UPLOAD_URL = 'https://blockchain.didlab.org/api/ipfs/add'
export const IPFS_GATEWAY = 'https://gateway.didlab.org/ipfs/'

/** The exact message the portal signs to derive the AES key. */
function authMessage(address, timestamp) {
  return `Authorize DIDLab IPFS upload\nAddress:${address}\nTimestamp:${timestamp}`
}

/** AES-256 key = keccak256(signature bytes), imported for WebCrypto AES-GCM. */
async function deriveKey(signature, usages) {
  const keyBytes = ethers.getBytes(ethers.keccak256(ethers.getBytes(signature)))
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, usages)
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
const toB64 = bytes => btoa(String.fromCharCode(...bytes))
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/**
 * Encrypt `bytes` with the connected wallet and upload to DIDLab Secure IPFS.
 * @param signer  an ethers signer (from MetaMask)
 * @param bytes   Uint8Array of the file to store
 * @returns { cid, iv, timestamp, address } - keep iv + timestamp to decrypt later
 */
export async function uploadEncrypted(signer, bytes) {
  const address   = await signer.getAddress()
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await signer.signMessage(authMessage(address, timestamp))

  const key = await deriveKey(signature, ['encrypt'])
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  // WebCrypto AES-GCM output is ciphertext followed by the 16-byte auth tag.
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes))
  const sha256 = toHex(await crypto.subtle.digest('SHA-256', enc))

  const form = new FormData()
  form.append('file', new Blob([enc], { type: 'application/octet-stream' }), `didlab-${crypto.randomUUID()}.bin`)
  form.append('pin', 'true')
  form.append('wrapWithDirectory', 'false')
  form.append('address', address)
  form.append('timestamp', String(timestamp))
  form.append('signature', signature)
  form.append('sha256', sha256)
  form.append('sizeBytes', String(bytes.length))

  const res = await fetch(UPLOAD_URL, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`IPFS upload failed (${res.status}): ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const cid = data.cid || data.Hash || data.hash || data.CID
  if (!cid) throw new Error('IPFS upload returned no CID: ' + JSON.stringify(data))

  return { cid, iv: toB64(iv), timestamp, address }
}

/** Convenience: encrypt + upload a JS object as a JSON file. */
export async function uploadJSON(signer, obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  return uploadEncrypted(signer, bytes)
}

/**
 * Fetch an encrypted blob from the gateway and decrypt it locally.
 * Needs the same wallet that uploaded it, plus the stored iv + timestamp.
 * @returns Uint8Array of the original plaintext
 */
export async function fetchDecrypted(signer, { cid, iv, timestamp }) {
  const address   = await signer.getAddress()
  const signature = await signer.signMessage(authMessage(address, timestamp))
  const key = await deriveKey(signature, ['decrypt'])

  const res = await fetch(IPFS_GATEWAY + cid)
  if (!res.ok) throw new Error(`Gateway fetch failed (${res.status})`)
  const enc = new Uint8Array(await res.arrayBuffer())

  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, enc)
  return new Uint8Array(plain)
}

/** Decrypt straight to a parsed JSON object. */
export async function fetchDecryptedJSON(signer, ref) {
  return JSON.parse(new TextDecoder().decode(await fetchDecrypted(signer, ref)))
}

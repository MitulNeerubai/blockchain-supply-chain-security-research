// Notification-email service (server.js). Emails are bound to a wallet address,
// and linking one requires a wallet signature so nobody can hijack another's alerts.
const API = '/api'

async function call(path, opts) {
  let r
  try { r = await fetch(API + path, opts) }
  catch { throw new Error('The notification service is unreachable right now.') }
  let json = {}
  try { json = await r.json() } catch { /* non-JSON */ }
  if (!r.ok) throw new Error(json.error || `Notification service error (${r.status}).`)
  return json
}
const post = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const linkMessage = (email, address) =>
  `DIDLab Supply Chain\nLink notification email ${email.trim().toLowerCase()} to wallet ${address.toLowerCase()}`

export const apiHealth = () => call('/health').then(() => true).catch(() => false)
export const getEmail = address => call('/email/' + address.toLowerCase()).then(d => d.email || '')
export const sendOtp = (email, address) => post('/email/send-otp', { email: email.trim(), address })
export const verifyOtp = (email, address, otp, signature) => post('/email/verify-otp', { email: email.trim(), address, otp: otp.trim(), signature })

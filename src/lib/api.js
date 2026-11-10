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

/** True if the email service answers. Retries for ~10 s: a cPanel/Passenger app
 *  that was asleep or just restarted needs a few seconds to come up. */
export async function apiHealth(tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { await call('/health'); return true } catch { /* not up yet */ }
    if (i < tries - 1) await new Promise(r => setTimeout(r, 2000))
  }
  return false
}
export const getEmail = address => call('/email/' + address.toLowerCase()).then(d => d.email || '')
export const sendOtp = (email, address) => post('/email/send-otp', { email: email.trim(), address })
export const verifyOtp = (email, address, otp, signature) => post('/email/verify-otp', { email: email.trim(), address, otp: otp.trim(), signature })

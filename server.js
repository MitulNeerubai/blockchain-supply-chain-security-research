// server.js — notification-email API + static file server for the built UI
//
//   POST /api/email/send-otp    { email, address }              → emails a 6-digit code
//   POST /api/email/verify-otp  { email, address, otp, signature } → links email to wallet
//   GET  /api/email/:address                                      → { email }
//   GET  /api/health
//
// Emails are stored per wallet in emails.json ({ "0xabc…": "a@b.com" }).
// Linking requires a MetaMask signature, so nobody can redirect another wallet's alerts.

import http from 'http'
import tls from 'tls'
import { readFileSync, writeFileSync, existsSync, createReadStream, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, extname, resolve, sep } from 'path'
import { randomInt } from 'crypto'
import { verifyMessage, isAddress } from 'ethers'

const __dirname   = dirname(fileURLToPath(import.meta.url))
const EMAILS_PATH = join(__dirname, 'emails.json')
const STATIC_DIR  = resolve(__dirname, process.env.STATIC_DIR || 'dist')
const PORT        = parseInt(process.env.APP_PORT || process.env.PORT) || 3001  // PORT is set by cPanel/Passenger

// ─── .env (no dotenv needed) ────────────────────────────────────────────────
try {
  for (const line of readFileSync(join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) process.env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, '')
  }
} catch { /* no .env */ }

// ─── Must match src/lib/api.js linkMessage() ────────────────────────────────
const linkMessage = (email, address) =>
  `DIDLab Supply Chain\nLink notification email ${email.trim().toLowerCase()} to wallet ${address.toLowerCase()}`

// ─── OTP store with expiry + attempt / resend limits ────────────────────────
const OTP_TTL = 5 * 60 * 1000
const RESEND_GAP = 30 * 1000
const MAX_ATTEMPTS = 5
const otps = new Map() // address → { email, otp, expiresAt, sentAt, attempts }

function cleanOTPs() {
  const now = Date.now()
  for (const [k, v] of otps) if (v.expiresAt < now) otps.delete(k)
}

// ─── emails.json ────────────────────────────────────────────────────────────
function readEmails() {
  try { return existsSync(EMAILS_PATH) ? JSON.parse(readFileSync(EMAILS_PATH, 'utf8')) : {} } catch { return {} }
}
function writeEmails(data) { writeFileSync(EMAILS_PATH, JSON.stringify(data, null, 2)) }

// ─── SMTP via Gmail port 465 (implicit TLS) ─────────────────────────────────
function sendOTPEmail(to, otp) {
  return new Promise((resolveP, reject) => {
    const user = process.env.GMAIL_USER || ''
    const pass = process.env.GMAIL_PASS || ''
    if (!user || !pass) return reject(new Error('Email sending is not configured on the server (GMAIL_USER / GMAIL_PASS).'))

    const msg = [
      `From: "DIDLab Supply Chain" <${user}>`,
      `To: ${to}`,
      `Subject: Your verification code: ${otp}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Your DIDLab Supply Chain verification code is:',
      '',
      `    ${otp}`,
      '',
      'It expires in 5 minutes. If you did not request it, ignore this email.',
    ].join('\r\n')

    const sock = tls.connect({ host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com' })
    let step = 0, buf = ''
    sock.on('data', chunk => {
      buf += chunk.toString()
      const lines = buf.split('\r\n'); buf = lines.pop()
      for (const line of lines) {
        if (!line || line[3] === '-') continue
        const code = parseInt(line.slice(0, 3), 10)
        if (code >= 400) { sock.destroy(); return reject(new Error(`SMTP ${code}: ${line.slice(4)}`)) }
        if (code === 220 && step === 0) { step = 1; sock.write('EHLO localhost\r\n') }
        else if (step === 1 && code === 250) { step = 2; sock.write('AUTH LOGIN\r\n') }
        else if (step === 2 && code === 334) { step = 3; sock.write(Buffer.from(user).toString('base64') + '\r\n') }
        else if (step === 3 && code === 334) { step = 4; sock.write(Buffer.from(pass).toString('base64') + '\r\n') }
        else if (step === 4 && code === 235) { step = 5; sock.write(`MAIL FROM:<${user}>\r\n`) }
        else if (step === 5 && code === 250) { step = 6; sock.write(`RCPT TO:<${to}>\r\n`) }
        else if (step === 6 && code === 250) { step = 7; sock.write('DATA\r\n') }
        else if (step === 7 && code === 354) { step = 8; sock.write(msg.replace(/^\./gm, '..') + '\r\n.\r\n') }
        else if (step === 8 && code === 250) { step = 9; sock.write('QUIT\r\n') }
        else if (step === 9 && code === 221) { sock.end(); resolveP() }
      }
    })
    sock.on('error', reject)
    sock.setTimeout(20000, () => { sock.destroy(); reject(new Error('SMTP timeout')) })
  })
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://localhost:4173', 'https://mitul.didlab.org'])
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise(res => {
    let raw = ''
    req.on('data', c => { raw += c; if (raw.length > 10_000) req.destroy() })
    req.on('end', () => { try { res(JSON.parse(raw)) } catch { res({}) } })
  })
}

// ─── Handlers ───────────────────────────────────────────────────────────────
async function handleSendOTP(req, res) {
  const { email = '', address = '' } = await readBody(req)
  if (!EMAIL_RE.test(email.trim())) return json(res, 400, { error: 'Enter a valid email address.' })
  if (!isAddress(address)) return json(res, 400, { error: 'Invalid wallet address.' })
  cleanOTPs()
  const key = address.toLowerCase()
  const prev = otps.get(key)
  if (prev && Date.now() - prev.sentAt < RESEND_GAP) return json(res, 429, { error: 'Please wait 30 seconds before requesting another code.' })
  const otp = String(randomInt(100000, 1000000))
  await sendOTPEmail(email.trim(), otp)
  otps.set(key, { email: email.trim().toLowerCase(), otp, expiresAt: Date.now() + OTP_TTL, sentAt: Date.now(), attempts: 0 })
  console.log(`[server] OTP sent to ${email.trim()} for ${short(key)}`)
  json(res, 200, { ok: true, message: `We sent a 6-digit code to ${email.trim()}.` })
}

async function handleVerifyOTP(req, res) {
  const { email = '', address = '', otp = '', signature = '' } = await readBody(req)
  if (!isAddress(address)) return json(res, 400, { error: 'Invalid wallet address.' })
  cleanOTPs()
  const key = address.toLowerCase()
  const rec = otps.get(key)
  if (!rec || rec.email !== email.trim().toLowerCase()) return json(res, 400, { error: 'No active code for this email. Request a new one.' })
  if (++rec.attempts > MAX_ATTEMPTS) { otps.delete(key); return json(res, 429, { error: 'Too many attempts. Request a new code.' }) }
  if (rec.otp !== String(otp).trim()) return json(res, 400, { error: 'Incorrect code. Try again.' })

  let signer
  try { signer = verifyMessage(linkMessage(email, address), signature) } catch { signer = '' }
  if (signer.toLowerCase() !== key) return json(res, 401, { error: 'Wallet signature did not match this address.' })

  const emails = readEmails()
  emails[key] = rec.email
  writeEmails(emails)
  otps.delete(key)
  console.log(`[server] Linked ${rec.email} → ${short(key)}`)
  json(res, 200, { ok: true, message: `Notifications will be sent to ${rec.email}.` })
}

const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`

// ─── Static files (only inside STATIC_DIR — no path traversal) ──────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.json': 'application/json' }

function serveStatic(pathname, res) {
  let rel
  try { rel = decodeURIComponent(pathname) } catch { return json(res, 400, { error: 'Bad path' }) }
  const file = resolve(STATIC_DIR, '.' + (rel === '/' ? '/index.html' : rel))
  const inside = file === STATIC_DIR || file.startsWith(STATIC_DIR + sep)
  const target = inside && existsSync(file) && statSync(file).isFile() ? file : join(STATIC_DIR, 'index.html') // SPA fallback
  if (!existsSync(target)) return json(res, 404, { error: 'UI not built. Run: npm run build' })
  const mime = MIME[extname(target)] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': mime.startsWith('text/html') ? 'no-store' : 'public, max-age=31536000, immutable' })
  createReadStream(target).pipe(res)
}

// ─── Server ─────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  const pathname = (req.url || '/').split('?')[0]
  // nginx may strip the /api prefix before proxying — accept both forms
  const api = pathname.startsWith('/api/') ? pathname.slice(4) : pathname

  try {
    if (req.method === 'GET'  && api === '/health')            return json(res, 200, { ok: true })
    if (req.method === 'POST' && api === '/email/send-otp')    return await handleSendOTP(req, res)
    if (req.method === 'POST' && api === '/email/verify-otp')  return await handleVerifyOTP(req, res)
    const m = api.match(/^\/email\/(0x[0-9a-fA-F]{40})$/)
    if (req.method === 'GET' && m) return json(res, 200, { address: m[1], email: readEmails()[m[1].toLowerCase()] || '' })
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' })
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(pathname, res)
    json(res, 405, { error: 'Method not allowed' })
  } catch (e) {
    console.error('[server]', e.message)
    json(res, 500, { error: e.message })
  }
})

server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (static: ${STATIC_DIR})`)
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) console.warn('[server] GMAIL_USER / GMAIL_PASS not set — OTP emails will fail')
})

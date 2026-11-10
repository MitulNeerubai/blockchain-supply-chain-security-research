import http from 'http'
import tls  from 'tls'
import { readFileSync, writeFileSync, existsSync, createReadStream } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, extname } from 'path'

const __dirname   = dirname(fileURLToPath(import.meta.url))
const EMAILS_PATH = join(__dirname, 'emails.json')
const PORT        = parseInt(process.env.APP_PORT) || 3001

// ─── Load .env manually (no dotenv needed) ───────────────────────────────────
function loadEnv() {
  try {
    const lines = readFileSync(join(__dirname, '.env'), 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m) process.env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, '')
    }
  } catch {}
}
loadEnv()

// ─── OTP store ────────────────────────────────────────────────────────────────
const otpStore = {}  // { email: { otp, role, expiresAt } }
const OTP_TTL  = 5 * 60 * 1000

function cleanOTPs() {
  const now = Date.now()
  for (const k of Object.keys(otpStore)) {
    if (otpStore[k].expiresAt < now) delete otpStore[k]
  }
}

// ─── emails.json helpers ──────────────────────────────────────────────────────
function readEmails() {
  try {
    if (!existsSync(EMAILS_PATH)) return { LG:'', MF:'', DT:'', RT:'' }
    return JSON.parse(readFileSync(EMAILS_PATH, 'utf8'))
  } catch { return { LG:'', MF:'', DT:'', RT:'' } }
}
function writeEmails(data) {
  writeFileSync(EMAILS_PATH, JSON.stringify(data, null, 2))
}

// ─── SMTP email via Gmail port 465 (implicit TLS, no nodemailer needed) ───────
const ROLE_LABEL = { LG:'Local Government', MF:'Manufacturer', DT:'Distributor', RT:'Retailer' }

function sendOTPEmail(to, otp, role) {
  return new Promise((resolve, reject) => {
    const user = process.env.GMAIL_USER || ''
    const pass = process.env.GMAIL_PASS || ''
    if (!user || !pass) return reject(new Error('GMAIL_USER / GMAIL_PASS not set in .env'))

    const subject = '[Supply Chain] Your Email Verification Code'
    const body = [
      `Your one-time verification code is:`,
      ``,
      `  ${otp}`,
      ``,
      `This code expires in 5 minutes.`,
      `Role: ${ROLE_LABEL[role] || role}`,
      ``,
      `If you did not request this, ignore this email.`,
    ].join('\n')

    const msg = [
      `From: "Supply Chain SSI" <${user}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      ``,
      body,
    ].join('\r\n')

    const sock = tls.connect({ host: 'smtp.gmail.com', port: 465 })
    let step = 0
    let buf  = ''

    sock.on('secureConnect', () => { /* wait for 220 greeting */ })

    sock.on('data', chunk => {
      buf += chunk.toString()
      const lines = buf.split('\r\n')
      buf = lines.pop()

      for (const line of lines) {
        if (!line) continue
        const code   = parseInt(line.slice(0, 3), 10)
        const isLast = line[3] !== '-'
        if (!isLast) continue

        console.log(`[smtp ←] ${line}`)

        if (code === 220) {
          sock.write('EHLO localhost\r\n')
        } else if (step === 0 && code === 250) {
          step = 1; sock.write('AUTH LOGIN\r\n')
        } else if (step === 1 && code === 334) {
          step = 2; sock.write(Buffer.from(user).toString('base64') + '\r\n')
        } else if (step === 2 && code === 334) {
          step = 3; sock.write(Buffer.from(pass).toString('base64') + '\r\n')
        } else if (step === 3 && code === 235) {
          step = 4; sock.write(`MAIL FROM:<${user}>\r\n`)
        } else if (step === 4 && code === 250) {
          step = 5; sock.write(`RCPT TO:<${to}>\r\n`)
        } else if (step === 5 && code === 250) {
          step = 6; sock.write('DATA\r\n')
        } else if (step === 6 && code === 354) {
          step = 7; sock.write(msg + '\r\n.\r\n')
        } else if (step === 7 && code === 250) {
          step = 8; sock.write('QUIT\r\n')
        } else if (step === 8 && code === 221) {
          sock.end(); resolve()
        } else if (code >= 400) {
          sock.destroy(); reject(new Error(`SMTP ${code}: ${line.slice(4)}`))
        }
      }
    })

    sock.on('error', err => reject(err))
    sock.setTimeout(20000, () => { sock.destroy(); reject(new Error('SMTP timeout')) })
  })
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5174',
  'https://mitul.didlab.org',
]

function setCORS(req, res) {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function jsonResp(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', c => raw += c)
    req.on('end', () => {
      try { resolve(JSON.parse(raw)) } catch { resolve({}) }
    })
  })
}

// ─── Route handlers ───────────────────────────────────────────────────────────
async function handleSendOTP(req, res) {
  const { email, role } = await readBody(req)
  if (!email?.includes('@')) return jsonResp(res, 400, { error: 'Invalid email address.' })
  if (!['LG','MF','DT','RT'].includes(role)) return jsonResp(res, 400, { error: 'Invalid role.' })
  cleanOTPs()
  const otp = String(Math.floor(100000 + Math.random() * 900000))
  otpStore[email] = { otp, role, expiresAt: Date.now() + OTP_TTL }
  console.log(`[server] 📧 Sending OTP ${otp} to ${email} (role: ${role})`)
  await sendOTPEmail(email, otp, role)
  jsonResp(res, 200, { ok: true, message: `Verification code sent to ${email}. Check your inbox.` })
}

async function handleVerifyOTP(req, res) {
  const { email, role, otp } = await readBody(req)
  if (!email || !role || !otp) return jsonResp(res, 400, { error: 'Missing fields.' })
  cleanOTPs()
  const rec = otpStore[email]
  if (!rec)                       return jsonResp(res, 400, { error: 'No OTP found for this email. Request a new code.' })
  if (Date.now() > rec.expiresAt) {
    delete otpStore[email]
    return jsonResp(res, 400, { error: 'OTP expired. Request a new code.' })
  }
  if (rec.role !== role)          return jsonResp(res, 400, { error: 'Role mismatch.' })
  if (rec.otp !== String(otp).trim()) return jsonResp(res, 400, { error: 'Incorrect code. Try again.' })
  const emails = readEmails()
  emails[role] = email
  writeEmails(emails)
  delete otpStore[email]
  console.log(`[server] ✅ Verified ${email} → role ${role}`)
  jsonResp(res, 200, { ok: true, message: `Email verified! Notifications will be sent to ${email}.` })
}

// ─── Main server ──────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
}

const server = http.createServer(async (req, res) => {
  setCORS(req, res)

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // nginx strips /api/ prefix before forwarding — normalize it back
  const _u  = req.url?.split('?')[0] ?? ''
  const url = _u.startsWith('/api') ? _u : '/api' + _u

  try {
    if (req.method === 'POST' && url === '/api/email/send-otp')   return await handleSendOTP(req, res)
    if (req.method === 'POST' && url === '/api/email/verify-otp') return await handleVerifyOTP(req, res)
    if (req.method === 'GET'  && url === '/api/emails')           return jsonResp(res, 200, readEmails())

    // GET /api/email/:role
    const m = url.match(/^\/api\/email\/([A-Z]{2})$/)
    if (req.method === 'GET' && m) {
      const emails = readEmails()
      return jsonResp(res, 200, { role: m[1], email: emails[m[1]] || '' })
    }

    // Serve static files (fallback when no nginx in front)
    const staticFile = join(__dirname, 'public', _u === '/' ? 'index.html' : _u)
    if (existsSync(staticFile)) {
      const mime = MIME[extname(staticFile)] || 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': mime === 'text/html' ? 'no-store' : 'public, max-age=31536000' })
      createReadStream(staticFile).pipe(res)
      return
    }

    // SPA fallback
    if (!url.startsWith('/api')) {
      const idx = join(__dirname, 'public', 'index.html')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      createReadStream(idx).pipe(res)
      return
    }

    jsonResp(res, 404, { error: 'Not found' })
  } catch (e) {
    console.error('[server] ❌', e.message)
    jsonResp(res, 500, { error: e.message })
  }
})

server.listen(PORT, () => {
  console.log(`[server] 🚀 OTP server running on http://localhost:${PORT}`)
  console.log(`[server] emails.json: ${EMAILS_PATH}`)
  if (!process.env.GMAIL_USER) console.warn('[server] ⚠️  GMAIL_USER not set in .env')
  if (!process.env.GMAIL_PASS) console.warn('[server] ⚠️  GMAIL_PASS not set in .env')
})

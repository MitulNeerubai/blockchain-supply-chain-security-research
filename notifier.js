/**
 * notifier.js — emails participants about supply-chain events.
 *
 * Reads contract addresses/ABIs from src/deployment.json (written by deploy_all.cjs)
 * and per-wallet emails from emails.json (written by server.js).
 *
 *   .env: GMAIL_USER, GMAIL_PASS, optional BESU_RPC (defaults to the deployment RPC)
 *   run : npm run notifier
 */
import { ethers } from 'ethers'
import nodemailer from 'nodemailer'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const depPath = ['src/deployment.json', 'supply-chain-ui/src/deployment.json'].map(p => join(__dirname, p)).find(existsSync)
if (!depPath) throw new Error('deployment.json not found — run the deploy script first')
const dep = JSON.parse(readFileSync(depPath, 'utf8'))
const RPC = process.env.BESU_RPC || dep.rpcUrl
const PORTAL = process.env.PORTAL_URL || 'https://mitul.didlab.org'

const provider = new ethers.JsonRpcProvider(RPC, dep.chainId, { staticNetwork: true })
const C = name => new ethers.Contract(dep.contracts[name].address, dep.contracts[name].abi, provider)
const pt = C('pt'), did = C('did'), cred = C('cred'), trust = C('trust')

const emailOf = addr => {
  try { return JSON.parse(readFileSync(join(__dirname, 'emails.json'), 'utf8'))[addr.toLowerCase()] || null } catch { return null }
}
const nameOf = async addr => { try { const d = await did.getDID(addr); return d.companyName || addr } catch { return addr } }

const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS } })

async function notify(addr, subject, lines) {
  const to = emailOf(addr)
  if (!to) return console.log(`[notifier] no email for ${addr} — skipped "${subject}"`)
  try {
    await transporter.sendMail({
      from: `"DIDLab Supply Chain" <${process.env.GMAIL_USER}>`,
      to, subject: `[Supply Chain] ${subject}`,
      text: [...lines, '', `Open the portal: ${PORTAL}`].join('\n'),
    })
    console.log(`[notifier] ✉ ${to}: ${subject}`)
  } catch (e) { console.error(`[notifier] failed to email ${to}:`, e.message) }
}

const product = async id => { try { return (await pt.getProduct(id)).name } catch { return `#${id}` } }

pt.on('ProductShipped', async (id, from, to) => {
  await notify(to, `Incoming shipment: ${await product(id)}`, [
    `${await nameOf(from)} shipped product #${id} (${await product(id)}) to you.`,
    'Log in and accept it to take custody.',
  ])
})

pt.on('ProductReceived', async (id, by) => {
  const h = await pt.getTransferHistory(id)
  const sender = h[h.length - 1]?.from
  if (sender) await notify(sender, `Shipment received: ${await product(id)}`, [`${await nameOf(by)} confirmed receipt of product #${id}.`])
})

pt.on('ShipmentCancelled', async (id, by, recipient) => {
  await notify(recipient, `Shipment cancelled: ${await product(id)}`, [`${await nameOf(by)} cancelled the shipment of product #${id} to you.`])
})

pt.on('ProductForceRecalled', async (id, by, from) => {
  await notify(from, `Product recalled: ${await product(id)}`, [`${await nameOf(by)} recalled product #${id} from your inventory.`])
})

pt.on('ProductReclaimed', async (id, from, to, reason) => {
  await notify(from, `Product called back: ${await product(id)}`, [`Product #${id} was moved back to ${await nameOf(to)}.`, reason])
  await notify(to, `Product called back to you: ${await product(id)}`, [`Product #${id} is back in your stock.`, reason])
})

pt.on('ShipmentReverted', async (id, sender, recipient, reason) => {
  await notify(sender, `Shipment reverted: ${await product(id)}`, [`Your shipment of product #${id} to ${await nameOf(recipient)} returned to your stock.`, reason])
  await notify(recipient, `Shipment withdrawn: ${await product(id)}`, [`The shipment of product #${id} from ${await nameOf(sender)} was withdrawn.`, reason])
})

pt.on('ProductReturned', async (id, from, to, reason) => {
  await notify(to, `Return incoming: ${await product(id)}`, [`${await nameOf(from)} is returning product #${id} to you.`, `Reason: ${reason}`, 'Log in and accept the return.'])
})

// ─── Optional keeper: automatically revert in-transit shipments whose recipient
// lost its licence (revoked / expired). Set KEEPER_PRIVATE_KEY in .env to a wallet
// with a little TRUST for gas. Products already held are NOT moved automatically —
// the upstream company decides with the "Call back" button.
const KEEPER_KEY = (process.env.KEEPER_PRIVATE_KEY || '').trim()
if (/^(0x)?[0-9a-fA-F]{64}$/.test(KEEPER_KEY)) {
  const keeper = new ethers.Wallet(KEEPER_KEY, provider)
  const ptW = pt.connect(keeper)
  let running = false
  async function sweep(why) {
    if (running) return
    running = true
    try {
      const total = Number(await pt.totalProducts())
      const ids = Array.from({ length: total }, (_, i) => i + 1)
      for (let i = 0; i < ids.length; i += 150) {
        const part = ids.slice(i, i + 150)
        const rows = await pt.getProducts(part)
        for (const p of rows) {
          if (Number(p.status) !== 1) continue                      // only In transit
          const [ok, reason] = await pt.reclaimable(p.id)
          if (!ok) continue
          console.log(`[keeper] (${why}) reverting #${p.id}: ${reason}`)
          await (await ptW.reclaimProduct(p.id)).wait()
        }
      }
    } catch (e) { console.error('[keeper] sweep failed:', e.shortMessage || e.message) }
    running = false
  }
  cred.on('CredentialRevoked', () => sweep('licence revoked'))
  trust.on('IssuerRevoked', () => sweep('LG revoked'))
  setInterval(() => sweep('expiry check'), 5 * 60 * 1000)        // expiries emit no event
  sweep('startup')
  console.log(`[keeper] auto-revert enabled (wallet ${keeper.address})`)
} else {
  console.log('[keeper] disabled — set KEEPER_PRIVATE_KEY in .env to auto-revert shipments when a licence lapses')
}

cred.on('CredentialIssued', async (_id, issuer, holder, type, expiresAt) => {
  await notify(holder, `Licence issued: ${type}`, [
    `${await nameOf(issuer)} issued you a ${type}.`,
    `Valid until ${new Date(Number(expiresAt) * 1000).toDateString()}.`,
  ])
})

cred.on('CredentialRevoked', async (_id, by, holder) => {
  await notify(holder, 'Your licence was revoked', [`${await nameOf(by)} revoked your licence. You can no longer send or receive products until a new one is issued.`])
})

trust.on('IssuerAuthorized', async issuer => {
  await notify(issuer, 'Local Government licence granted', ['The Root Governance Authority granted your Local Government licence. You can now license Manufacturers.'])
})

trust.on('IssuerRevoked', async issuer => {
  await notify(issuer, 'Local Government licence revoked', ['The Root Governance Authority revoked your Local Government licence. Manufacturers you licensed are suspended.'])
})

console.log(`[notifier] listening on ${RPC} (chain ${dep.chainId}) — ProductTransfer ${dep.contracts.pt.address}`)

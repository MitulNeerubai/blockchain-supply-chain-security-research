/**
 * notifier.js — Supply Chain Email Notifier
 *
 * Watches your Hyperledger Besu node for ProductTransfer events
 * and sends automated emails via Gmail/SMTP using Nodemailer.
 *
 * Setup:
 *   1. npm install ethers nodemailer dotenv
 *   2. Create a .env file with:
 *        GMAIL_USER=your-gmail@gmail.com
 *        GMAIL_PASS=your-app-password        <-- put ur app password here
 *        BESU_RPC=http://127.0.0.1:8545
 *   3. Fill in emails.json with actual email addresses
 *   4. Run: node notifier.js
 */

import { ethers }    from 'ethers'
import nodemailer    from 'nodemailer'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv        from 'dotenv'
dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Config ──────────────────────────────────────────────────────────────────
const BESU_RPC = process.env.BESU_RPC || 'http://127.0.0.1:8545'

const ADDR = {
  trust: '0xebb08092bB30ba254fb5c0268b1b55d3b57E0006',
  did:   '0x69c5b83617A11bB59c2585900E5E07fd0212A13e',
  cred:  '0x1F2Ae189038347cfEfF196C4CFF4f478fD4e2d55',
  pt:    '0x17ED77CDC9C3239a755AC0115eB67937526642E4',
  audit: '0x30191C6502C49a997bEA3fAD6FF120749AC7CF0b',
}

const PT_ABI = [
  'function getProduct(uint256 productId) view returns (tuple(uint256 id, string name, string ipfsCID, address manufacturer, address currentHolder, address pendingRecipient, uint8 status, uint256 createdAt))',
  'event ProductCreated(uint256 indexed id, address indexed manufacturer, string name)',
  'event ProductShipped(uint256 indexed id, address indexed from, address indexed to)',
  'event ProductReceived(uint256 indexed id, address indexed by)',
  'event ProductDelivered(uint256 indexed id, address indexed retailer)',
  'event ShipmentCancelled(uint256 indexed id, address indexed by, address indexed recipient)',
  'event ProductForceRecalled(uint256 indexed id, address indexed by, address indexed from)',
]

const DID_ABI = [
  'function getDID(address) view returns (tuple(string did, string role, address controller, uint256 createdAt, bool active))',
]

// ─── Load email directory ─────────────────────────────────────────────────────
const emails = JSON.parse(readFileSync(join(__dirname, 'emails.json'), 'utf8'))

// ─── Nodemailer transporter ───────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,   // put ur app password here
  },
})

async function sendEmail(to, subject, body) {
  if (!to || !to.includes('@')) {
    console.log(`[notifier] No valid email for ${to}, skipping`)
    return
  }
  try {
    await transporter.sendMail({
      from: `"Supply Chain SSI" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text: body,
    })
    console.log(`[notifier] ✅ Email sent to ${to}: ${subject}`)
  } catch (e) {
    console.error(`[notifier] ❌ Failed to send email to ${to}:`, e.message)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function short(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

async function getRoleEmail(didC, addr) {
  try {
    const doc = await didC.getDID(addr)
    const role = doc.role
    return { role, email: emails[roleKey(role)] || null }
  } catch {
    return { role: 'Unknown', email: null }
  }
}

function roleKey(role) {
  if (role === 'LocalGovernment') return 'LG'
  if (role === 'Manufacturer')    return 'MF'
  if (role === 'Distributor')     return 'DT'
  if (role === 'Retailer')        return 'RT'
  return role
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const provider = new ethers.JsonRpcProvider(BESU_RPC)
  const ptC      = new ethers.Contract(ADDR.pt,  PT_ABI,  provider)
  const didC     = new ethers.Contract(ADDR.did, DID_ABI, provider)

  console.log('[notifier] 🚀 Listening for supply chain events on', BESU_RPC)
  console.log('[notifier] Email directory:', emails)

  // ── ProductCreated → notify LG ────────────────────────────────────────────
  ptC.on('ProductCreated', async (id, manufacturer, name) => {
    console.log(`[notifier] ProductCreated #${id} "${name}" by ${short(manufacturer)}`)
    const { role } = await getRoleEmail(didC, manufacturer)
    await sendEmail(
      emails.LG,
      `[Supply Chain] New Product Created: ${name}`,
      `A new product has been registered on the blockchain.\n\n` +
      `Product: ${name}\n` +
      `Product ID: ${id.toString()}\n` +
      `Manufacturer: ${manufacturer} (${role})\n\n` +
      `You can verify this product on the supply chain portal.`
    )
  })

  // ── ProductShipped → notify recipient ─────────────────────────────────────
  ptC.on('ProductShipped', async (id, from, to) => {
    console.log(`[notifier] ProductShipped #${id} from ${short(from)} to ${short(to)}`)
    try {
      const product     = await ptC.getProduct(id)
      const { role: toRole, email: toEmail } = await getRoleEmail(didC, to)
      const { role: fromRole }               = await getRoleEmail(didC, from)
      await sendEmail(
        toEmail,
        `[Supply Chain] Incoming Shipment: ${product.name}`,
        `A product has been shipped to you and is awaiting your confirmation.\n\n` +
        `Product: ${product.name}\n` +
        `Product ID: ${id.toString()}\n` +
        `From: ${from} (${fromRole})\n` +
        `To: ${to} (${toRole})\n\n` +
        `Please log in to the supply chain portal to confirm receipt.`
      )
    } catch (e) { console.error('[notifier] Error on ProductShipped:', e.message) }
  })

  // ── ProductReceived → notify sender ───────────────────────────────────────
  ptC.on('ProductReceived', async (id, by) => {
    console.log(`[notifier] ProductReceived #${id} by ${short(by)}`)
    try {
      const product = await ptC.getProduct(id)
      // Find the sender from transfer history by looking at currentHolder
      // The previous holder is the manufacturer or distributor who shipped it
      const { role: byRole } = await getRoleEmail(didC, by)

      // Notify the manufacturer if DT confirmed, or DT if RT confirmed
      let notifyAddr = null
      if (byRole === 'Distributor') notifyAddr = product.manufacturer
      else if (byRole === 'Retailer') {
        // Last sender was the distributor — get from product history via event
        notifyAddr = product.manufacturer // fallback; event logs have exact from
      }

      if (notifyAddr) {
        const { role: senderRole, email: senderEmail } = await getRoleEmail(didC, notifyAddr)
        await sendEmail(
          senderEmail,
          `[Supply Chain] Product Receipt Confirmed: ${product.name}`,
          `Your shipment has been confirmed by the recipient.\n\n` +
          `Product: ${product.name}\n` +
          `Product ID: ${id.toString()}\n` +
          `Confirmed by: ${by} (${byRole})\n\n` +
          `The product is now in their inventory.`
        )
      }
    } catch (e) { console.error('[notifier] Error on ProductReceived:', e.message) }
  })

  // ── ShipmentCancelled → notify original recipient ─────────────────────────
  ptC.on('ShipmentCancelled', async (id, by, recipient) => {
    console.log(`[notifier] ShipmentCancelled #${id} by ${short(by)}, was going to ${short(recipient)}`)
    try {
      const product = await ptC.getProduct(id)
      const { role: byRole }              = await getRoleEmail(didC, by)
      const { role: recipRole, email: recipEmail } = await getRoleEmail(didC, recipient)
      await sendEmail(
        recipEmail,
        `[Supply Chain] Shipment Cancelled: ${product.name}`,
        `A shipment intended for you has been cancelled.\n\n` +
        `Product: ${product.name}\n` +
        `Product ID: ${id.toString()}\n` +
        `Cancelled by: ${by} (${byRole})\n` +
        `Reason: Your credential may have been revoked or expired.\n\n` +
        `Please contact your licensing authority to resolve this.`
      )
    } catch (e) { console.error('[notifier] Error on ShipmentCancelled:', e.message) }
  })

  // ── ProductForceRecalled → notify the party it was recalled from ──────────
  ptC.on('ProductForceRecalled', async (id, by, from) => {
    console.log(`[notifier] ProductForceRecalled #${id} by ${short(by)} from ${short(from)}`)
    try {
      const product = await ptC.getProduct(id)
      const { role: byRole }             = await getRoleEmail(didC, by)
      const { role: fromRole, email: fromEmail } = await getRoleEmail(didC, from)
      await sendEmail(
        fromEmail,
        `[Supply Chain] Product Force Recalled: ${product.name}`,
        `A product in your possession has been force recalled.\n\n` +
        `Product: ${product.name}\n` +
        `Product ID: ${id.toString()}\n` +
        `Recalled by: ${by} (${byRole})\n` +
        `From: ${from} (${fromRole})\n\n` +
        `This may be due to a credential revocation. Please contact your supply chain partner.`
      )
    } catch (e) { console.error('[notifier] Error on ProductForceRecalled:', e.message) }
  })
}

main().catch(console.error)

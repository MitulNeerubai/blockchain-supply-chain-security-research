import { useEffect, useState } from 'react'
import { getEmail, linkMessage, sendOtp, verifyOtp } from '../lib/api'
import { errMsg } from '../lib/format'
import { Alert, Button, Card, Field } from './ui'

/**
 * Email + one-time-code verification, bound to a wallet with a signature.
 * Used on the register page (compact) and in each dashboard's Notifications tab.
 */
export function EmailVerifier({ address, signer, onVerified, initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail)
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState('idle') // idle | sent | done
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  async function send() {
    setErr(''); setInfo(''); setBusy(true)
    try { const r = await sendOtp(email, address); setInfo(r.message); setStep('sent') }
    catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }
  async function verify() {
    setErr(''); setBusy(true)
    try {
      const signature = await signer.signMessage(linkMessage(email, address))
      const r = await verifyOtp(email, address, otp, signature)
      setInfo(r.message); setStep('done'); onVerified?.(email.trim().toLowerCase())
    } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  if (step === 'done') return <Alert type="success" title="Email verified">{info}</Alert>
  return (
    <div className="form">
      {step === 'idle' ? (
        <Field label="Email address" hint="We send a 6-digit code to confirm it's yours.">
          <div className="row">
            <input className="input grow" type="email" placeholder="you@company.com" value={email} onChange={e => { setEmail(e.target.value); setErr('') }} />
            <Button type="button" variant="secondary" loading={busy} disabled={!valid} onClick={send}>Send code</Button>
          </div>
        </Field>
      ) : (
        <Field label={`Code sent to ${email.trim()}`} hint="After entering the code, MetaMask asks you to sign a message (free, no gas) to prove you own this wallet.">
          <div className="row">
            <input className="input input-otp grow" inputMode="numeric" maxLength={6} placeholder="••••••" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
            <Button type="button" loading={busy} disabled={otp.length !== 6} onClick={verify}>Verify</Button>
            <Button type="button" variant="ghost" onClick={() => { setStep('idle'); setOtp(''); setInfo('') }}>Change</Button>
          </div>
        </Field>
      )}
      {info && step === 'sent' && <Alert type="info">{info}</Alert>}
      {err && <Alert type="error">{err}</Alert>}
    </div>
  )
}

export function EmailSettings({ address, signer }) {
  const [current, setCurrent] = useState(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)
  useEffect(() => { getEmail(address).then(setCurrent).catch(e => { setErr(errMsg(e)); setCurrent('') }) }, [address])

  return (
    <Card title="Notification email" subtitle="Get an email when a shipment is sent to you, confirmed, cancelled or recalled, and when your licence changes.">
      <div className="stack">
        {err && <Alert type="warning">{err}</Alert>}
        {current === null ? null : current && !editing ? (
          <div className="row-between">
            <div><div className="field-label">Current email</div><div className="strong" style={{ marginTop: 2 }}>{current}</div></div>
            <Button variant="secondary" onClick={() => setEditing(true)}>Change</Button>
          </div>
        ) : (
          <EmailVerifier address={address} signer={signer} onVerified={e => { setCurrent(e); setEditing(false) }} />
        )}
      </div>
    </Card>
  )
}

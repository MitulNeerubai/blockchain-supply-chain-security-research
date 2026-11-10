import { useEffect, useState } from 'react'
import { getContracts, reader } from '../lib/chain'
import { apiHealth } from '../lib/api'
import { ROLE_ICON, ROLE_LABEL, errMsg, short, validateCompanyName } from '../lib/format'
import { Alert, Button, Field } from '../components/ui'
import { EmailVerifier } from '../components/EmailSettings'

const ROLE_INFO = {
  LocalGovt:    'Licensed by the Root Authority. Issues Manufacturing Licenses to Manufacturers.',
  Manufacturer: 'Creates products. Licenses Distributors and ships products to them.',
  Distributor:  'Receives products from its Manufacturer. Licenses Retailers and ships to them.',
  Retailer:     'Receives products from its Distributor and verifies the full chain.',
}

export default function Register({ address, signer, onRegistered }) {
  const [role, setRole] = useState('')
  const [name, setName] = useState('')
  const [avail, setAvail] = useState({ state: 'idle' }) // idle | checking | ok | taken | error
  const [emailOk, setEmailOk] = useState(false)
  const [service, setService] = useState(null) // null=checking, true/false
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { apiHealth().then(setService) }, [])

  // Live on-chain availability check for the company name
  const clean = name.trim()
  const nameErr = name ? validateCompanyName(name) : ''
  useEffect(() => {
    if (!clean || nameErr) { setAvail({ state: 'idle' }); return }
    setAvail({ state: 'checking' })
    const t = setTimeout(async () => {
      try { setAvail({ state: (await reader().did.isNameAvailable(clean)) ? 'ok' : 'taken' }) }
      catch (e) { setAvail({ state: 'error', msg: errMsg(e) }) }
    }, 350)
    return () => clearTimeout(t)
  }, [clean, nameErr])

  const emailStepDone = emailOk || service === false
  const ready = role && !nameErr && avail.state === 'ok' && emailStepDone
  const progress = [!!role, !!role && avail.state === 'ok', ready]

  async function register() {
    setErr(''); setBusy(true)
    try {
      const { did } = getContracts(signer)
      setStatus('Confirm the registration in MetaMask…')
      const tx = await did.registerDID(role, clean)
      setStatus('Writing your DID to the blockchain…')
      await tx.wait()
      setStatus('Registered!')
      await onRegistered()
    } catch (e) { setErr(errMsg(e)); setStatus('') }
    setBusy(false)
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card wide">
        <div className="auth-hero" style={{ paddingBottom: 0 }}>
          <h1 className="auth-title">Register your company</h1>
          <p className="auth-sub">Create your on-chain identity (DID). Wallet <code>{short(address)}</code></p>
        </div>
        <div className="card-body stack" style={{ padding: 24 }}>
          <div className="steps">{progress.map((d, i) => <div key={i} className={`step${d ? ' done' : ''}`} />)}</div>

          <div>
            <div className="field-label" style={{ marginBottom: 8 }}>1. Your role</div>
            <div className="role-grid">
              {Object.keys(ROLE_INFO).map(r => (
                <button key={r} type="button" className={`role-card${role === r ? ' active' : ''}`} onClick={() => setRole(r)}>
                  <span className="role-card-icon">{ROLE_ICON[r]}</span>
                  <span><span className="role-card-title">{ROLE_LABEL[r]}</span><span className="role-card-desc" style={{ display: 'block' }}>{ROLE_INFO[r]}</span></span>
                </button>
              ))}
            </div>
          </div>

          <Field
            label="2. Company name"
            error={nameErr || (avail.state === 'taken' ? `“${clean}” is already registered. Choose a different name.` : avail.state === 'error' ? avail.msg : '')}
            ok={avail.state === 'ok' ? '✓ Available' : ''}
            hint={avail.state === 'checking' ? 'Checking availability…' : 'Stored on-chain and shown to everyone. Must be unique and cannot be changed later.'}
          >
            <input className={`input${nameErr || avail.state === 'taken' ? ' invalid' : ''}`} placeholder="e.g. Acme Manufacturing" maxLength={64} value={name} onChange={e => setName(e.target.value)} />
          </Field>

          <div>
            <div className="field-label" style={{ marginBottom: 8 }}>3. Notification email</div>
            {service === null ? <p className="faint small">Checking notification service…</p>
              : service === false ? <Alert type="warning">The notification service is offline. You can register now and add your email later from the Notifications tab.</Alert>
              : <EmailVerifier address={address} signer={signer} onVerified={() => setEmailOk(true)} />}
          </div>

          {err && <Alert type="error">{err}</Alert>}
          {status && !err && <Alert type="info">{status}</Alert>}

          <Button size="lg" block loading={busy} disabled={!ready} onClick={register}>
            {ready ? `Register as ${ROLE_LABEL[role]}` : 'Complete the steps above'}
          </Button>
          {role === 'LocalGovt' && <p className="faint small center">After registering, the Root Governance Authority must grant your LG licence.</p>}
          {role && role !== 'LocalGovt' && <p className="faint small center">After registering, a {ROLE_LABEL[{ Manufacturer: 'LocalGovt', Distributor: 'Manufacturer', Retailer: 'Distributor' }[role]]} must issue your licence.</p>}
        </div>
      </div>
    </div>
  )
}

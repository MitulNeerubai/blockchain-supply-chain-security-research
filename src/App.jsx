import { useCallback, useEffect, useState } from 'react'
import { connectWallet, hasWallet, loadIdentity } from './lib/chain'
import { DirectoryProvider, SessionProvider, useDirectory } from './lib/app'
import { errMsg } from './lib/format'
import { Alert, Button, Loading, ToastProvider } from './components/ui'
import { TopBar } from './components/Layout'
import Connect from './pages/Connect'
import Register from './pages/Register'
import RootGA from './pages/RootGA'
import LocalGovt from './pages/LocalGovt'
import Manufacturer from './pages/Manufacturer'
import Distributor from './pages/Distributor'
import Retailer from './pages/Retailer'
import Verify from './pages/Verify'

const DASHBOARD = { RootGA, LocalGovt, Manufacturer, Distributor, Retailer }
const REMEMBER = 'sc_connected'
const remember = v => {
  try { if (v) localStorage.setItem(REMEMBER, '1'); else localStorage.removeItem(REMEMBER) } catch { /* storage blocked */ }
}
const remembered = () => { try { return localStorage.getItem(REMEMBER) === '1' } catch { return false } }

export default function App() {
  const verifyId = new URLSearchParams(window.location.search).get('verify')
  return (
    <ToastProvider>
      <DirectoryProvider>
        {verifyId !== null ? <><TopBar /><Verify productId={verifyId} /></> : <Shell />}
      </DirectoryProvider>
    </ToastProvider>
  )
}

function Shell() {
  const dir = useDirectory()
  const [session, setSession] = useState(null)   // { signer, address, ...identity }
  const [phase, setPhase] = useState('boot')      // boot | connect | loading | ready
  const [err, setErr] = useState('')

  const open = useCallback(async ({ silent } = {}) => {
    const w = await connectWallet({ silent })
    if (!w) { setPhase('connect'); return }
    setPhase('loading')
    const identity = await loadIdentity(w.address)
    setSession({ ...w, ...identity })
    remember(true)
    setPhase('ready')
  }, [])

  // Auto-reconnect if this browser connected before
  useEffect(() => {
    if (!hasWallet() || !remembered()) { setPhase('connect'); return }
    open({ silent: true }).catch(e => { setErr(errMsg(e)); setPhase('connect') })
  }, [open])

  // Follow MetaMask account / network switches
  useEffect(() => {
    if (!hasWallet()) return
    const onAccounts = accs => {
      if (!accs?.length) { remember(false); setSession(null); setPhase('connect'); return }
      open({ silent: true }).catch(e => { setErr(errMsg(e)); setPhase('connect') })
    }
    const onChain = () => window.location.reload()
    window.ethereum.on?.('accountsChanged', onAccounts)
    window.ethereum.on?.('chainChanged', onChain)
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccounts)
      window.ethereum.removeListener?.('chainChanged', onChain)
    }
  }, [open])

  const disconnect = () => { remember(false); setSession(null); setPhase('connect') }
  const afterRegister = async () => { await dir.refresh(); await open({ silent: true }) }

  let body
  if (phase === 'boot' || phase === 'loading') body = <div className="auth-wrap"><Loading>{phase === 'boot' ? 'Starting…' : 'Reading your identity from the blockchain…'}</Loading></div>
  else if (!session) body = <Connect onConnect={() => open().catch(e => { throw e })} />
  else if (!session.role) body = <Register address={session.address} signer={session.signer} onRegistered={afterRegister} />
  else if (!session.isRootGA && !session.active) {
    body = <div className="auth-wrap"><div className="auth-card"><Alert type="error" title="Identity deactivated">The DID for this wallet has been deactivated and can no longer take part in the supply chain.</Alert></div></div>
  } else {
    const Page = DASHBOARD[session.role]
    body = Page ? <Page /> : <div className="page"><Alert type="error">Unknown role “{session.role}”.</Alert></div>
  }

  return (
    <SessionProvider session={session}>
      <TopBar session={session} onDisconnect={disconnect} />
      {err && phase === 'connect' && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <Alert type="error" action={<Button variant="ghost" size="sm" onClick={() => setErr('')}>Dismiss</Button>}>{err}</Alert>
        </div>
      )}
      {dir.error && session && <div className="page" style={{ paddingBottom: 0 }}><Alert type="warning">Could not load the company directory: {dir.error}</Alert></div>}
      {body}
    </SessionProvider>
  )
}

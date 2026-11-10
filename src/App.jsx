import { DirectoryProvider, NetworkProvider, ProfileProvider, SessionProvider, WalletProvider, useDirectory, useNetwork, useRoute, useWallet } from './lib/app'
import { Alert, Button, Loading, ToastProvider } from './components/ui'
import { TopBar } from './components/Layout'
import { ProfileModal } from './components/Network'
import Connect from './pages/Connect'
import Register from './pages/Register'
import RootGA from './pages/RootGA'
import LocalGovt from './pages/LocalGovt'
import Manufacturer from './pages/Manufacturer'
import Distributor from './pages/Distributor'
import Retailer from './pages/Retailer'
import Verify from './pages/Verify'
import Home from './pages/Home'
import AllProducts from './pages/AllProducts'
import Companies from './pages/Companies'
import Guide from './pages/Guide'

const DASHBOARD = { RootGA, LocalGovt, Manufacturer, Distributor, Retailer }

export default function App() {
  return (
    <ToastProvider>
      <DirectoryProvider>
        <NetworkProvider>
          <WalletProvider>
            <ProfileProvider render={(addr, close) => <ProfileModal address={addr} onClose={close} />}>
              <TopBar />
              <Router />
            </ProfileProvider>
          </WalletProvider>
        </NetworkProvider>
      </DirectoryProvider>
    </ToastProvider>
  )
}

/** Public pages need no wallet; only #/app asks for MetaMask. */
function Router() {
  const r = useRoute()
  switch (r.page) {
    case 'app': return <Dashboard />
    case 'products': return <AllProducts />
    case 'product':
    case 'verify': return <Verify productId={r.arg} />
    case 'companies': return <Companies />
    case 'guide': return <Guide />
    default: return <Home />
  }
}

function Dashboard() {
  const dir = useDirectory()
  const net = useNetwork()
  const w = useWallet()
  const s = w.session

  const afterRegister = async () => { await Promise.all([dir.refresh(), net.refresh()]); await w.reload() }

  let body
  if (w.phase === 'boot' || w.phase === 'loading') body = <div className="auth-wrap"><Loading>{w.phase === 'boot' ? 'Starting…' : 'Reading your identity from the blockchain…'}</Loading></div>
  else if (!s) body = <Connect onConnect={w.connect} />
  else if (!s.role) body = <Register address={s.address} signer={s.signer} onRegistered={afterRegister} />
  else if (!s.isRootGA && !s.active) {
    body = <div className="auth-wrap"><div className="auth-card"><Alert type="error" title="Identity deactivated">The DID for this wallet has been deactivated and can no longer take part in the supply chain.</Alert></div></div>
  } else {
    const Page = DASHBOARD[s.role]
    body = Page ? <Page /> : <div className="page"><Alert type="error">Unknown role “{s.role}”.</Alert></div>
  }

  return (
    <SessionProvider session={s}>
      {w.error && !s && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <Alert type="error" action={<Button variant="ghost" size="sm" onClick={w.clearError}>Dismiss</Button>}>{w.error}</Alert>
        </div>
      )}
      {dir.error && s && <div className="page" style={{ paddingBottom: 0 }}><Alert type="warning">Could not load the company directory: {dir.error}</Alert></div>}
      {body}
    </SessionProvider>
  )
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { connectWallet, getContracts, hasWallet, latestPerPair, loadDirectory, loadIdentity, loadNetwork } from './chain'
import { errMsg, nowSec, sameAddr, short } from './format'
import { useToast } from '../components/ui'

// ── Hash router (works on any static host, no nginx rewrites needed) ────────
function parseRoute() {
  const legacy = new URLSearchParams(window.location.search).get('verify')
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (!parts.length && legacy) return { page: 'product', arg: legacy }
  return { page: parts[0] || 'home', arg: parts[1] || '' }
}
export function go(path) {
  if (window.location.search) window.history.replaceState({}, '', window.location.pathname + '#' + path)
  if (window.location.hash !== '#' + path) window.location.hash = path
  window.scrollTo({ top: 0 })
}
export function useRoute() {
  const [r, setR] = useState(parseRoute)
  useEffect(() => {
    const f = () => setR(parseRoute())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return r
}

// ── Directory: every registered company, keyed by lowercase address ─────────
const DirCtx = createContext(null)

export function DirectoryProvider({ children }) {
  const [dir, setDir] = useState(() => new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try { setDir(await loadDirectory()); setError('') }
    catch (e) { setError(errMsg(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const value = useMemo(() => {
    const get = a => (a ? dir.get(a.toLowerCase()) : undefined)
    return {
      dir, loading, error, refresh, get,
      name: a => get(a)?.company || short(a),
      byRole: role => [...dir.values()].filter(d => d.role === role),
    }
  }, [dir, loading, error, refresh])
  return <DirCtx.Provider value={value}>{children}</DirCtx.Provider>
}
export const useDirectory = () => useContext(DirCtx)

// ── Network: every licence + LG authorisation (public, no wallet) ───────────
const NetCtx = createContext(null)

export function NetworkProvider({ children }) {
  const d = useDirectory()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try { setData(await loadNetwork()); setError('') } catch (e) { setError(errMsg(e)) }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const value = useMemo(() => {
    const creds = data ? latestPerPair(data.creds) : []
    const held = a => creds.filter(c => sameAddr(c.holder, a))
    const issued = a => creds.filter(c => sameAddr(c.issuer, a))
    const isRoot = a => !!data && sameAddr(a, data.rootGA)

    /** One status per company, used for the coloured dots everywhere. */
    function statusOf(a) {
      if (!data || !a) return { state: 'unknown', label: '…' }
      if (isRoot(a)) return { state: 'active', label: 'Root authority' }
      const who = d.get(a)
      if (!who) return { state: 'unknown', label: 'Not registered' }
      if (!who.active) return { state: 'revoked', label: 'DID deactivated' }
      if (who.role === 'LocalGovt') {
        const lg = data.lg[a.toLowerCase()]
        if (lg?.authorized) return { state: 'active', label: 'Licensed by Root' }
        return lg?.since ? { state: 'revoked', label: 'LG licence revoked' } : { state: 'pending', label: 'Awaiting Root approval' }
      }
      const mine = held(a)
      const live = mine.filter(c => c.active)
      if (live.length) return { state: 'active', label: live.length > 1 ? `${live.length} active licences` : 'Licence active' }
      if (!mine.length) return { state: 'pending', label: 'No licence yet' }
      const s = mine.sort((x, y) => y.issuedAt - x.issuedAt)[0].status
      return { state: s, label: { revoked: 'Licence revoked', expired: 'Licence expired', suspended: 'Licence suspended' }[s] || s }
    }

    /** Licence between issuer and holder (latest), or null. */
    const pair = (issuer, holder) => creds.find(c => sameAddr(c.issuer, issuer) && sameAddr(c.holder, holder)) || null

    return {
      ready: !!data, error, refresh, rootGA: data?.rootGA, lg: data?.lg || {}, creds, allCreds: data?.creds || [],
      held, issued, pair, statusOf, isRoot,
      expiringSoon: c => c.active && c.expiresAt - nowSec() < 14 * 86400,
    }
  }, [data, error, refresh, d])
  return <NetCtx.Provider value={value}>{children}</NetCtx.Provider>
}
export const useNetwork = () => useContext(NetCtx)

// ── Wallet: connected MetaMask account + on-chain identity ─────────────────
const WalletCtx = createContext(null)
const REMEMBER = 'sc_connected'
const remember = v => { try { if (v) localStorage.setItem(REMEMBER, '1'); else localStorage.removeItem(REMEMBER) } catch { /* storage blocked */ } }
const remembered = () => { try { return localStorage.getItem(REMEMBER) === '1' } catch { return false } }

export function WalletProvider({ children }) {
  const [session, setSession] = useState(null)   // { signer, address, ...identity }
  const [phase, setPhase] = useState('boot')      // boot | idle | loading | ready
  const [error, setError] = useState('')

  const open = useCallback(async ({ silent } = {}) => {
    const w = await connectWallet({ silent })
    if (!w) { setPhase('idle'); return }
    setPhase('loading')
    const identity = await loadIdentity(w.address)
    setSession({ ...w, ...identity })
    remember(true)
    setPhase('ready')
  }, [])

  // Silent auto-reconnect if this browser connected before (never pops MetaMask)
  useEffect(() => {
    if (!hasWallet() || !remembered()) { setPhase('idle'); return }
    open({ silent: true }).catch(e => { setError(errMsg(e)); setPhase('idle') })
  }, [open])

  useEffect(() => {
    if (!hasWallet()) return
    const onAccounts = accs => {
      if (!accs?.length) { remember(false); setSession(null); setPhase('idle'); return }
      if (remembered()) open({ silent: true }).catch(e => { setError(errMsg(e)); setPhase('idle') })
    }
    const onChain = () => window.location.reload()
    window.ethereum.on?.('accountsChanged', onAccounts)
    window.ethereum.on?.('chainChanged', onChain)
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccounts)
      window.ethereum.removeListener?.('chainChanged', onChain)
    }
  }, [open])

  const value = useMemo(() => ({
    session, phase, error, clearError: () => setError(''),
    connect: async () => { setError(''); try { await open() } catch (e) { setError(errMsg(e)); setPhase('idle'); throw e } },
    reload: () => open({ silent: true }),
    disconnect: () => { remember(false); setSession(null); setPhase('idle') },
  }), [session, phase, error, open])
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>
}
export const useWallet = () => useContext(WalletCtx)

// ── Session: signed-in wallet + write contracts (dashboard only) ────────────
const SessionCtx = createContext(null)
export function SessionProvider({ session, children }) {
  const value = useMemo(() => session && ({ ...session, write: getContracts(session.signer) }), [session])
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}
export const useSession = () => useContext(SessionCtx)

// ── Company profile modal (opened from any company name) ────────────────────
const ProfileCtx = createContext({ open: () => {} })
export const useProfile = () => useContext(ProfileCtx)
export function ProfileProvider({ children, render }) {
  const [addr, setAddr] = useState(null)
  const value = useMemo(() => ({ open: setAddr }), [])
  return (
    <ProfileCtx.Provider value={value}>
      {children}
      {addr && render(addr, () => setAddr(null))}
    </ProfileCtx.Provider>
  )
}

// ── Transactions with toast feedback ────────────────────────────────────────
export function useTx() {
  const toast = useToast()
  const net = useNetwork()
  const [busy, setBusy] = useState(null)
  const run = useCallback(async (key, send, { pending = 'Waiting for the block to confirm…', success = 'Transaction confirmed.', onDone } = {}) => {
    setBusy(key)
    const id = toast.show({ type: 'pending', text: 'Confirm the transaction in MetaMask…', sticky: true })
    try {
      const tx = await send()
      toast.update(id, { text: pending, sticky: true })
      const receipt = await tx.wait()
      toast.update(id, { type: 'success', text: success, sticky: false })
      net?.refresh()            // keep status dots / trust map current
      await onDone?.(receipt)
      return receipt
    } catch (e) {
      console.error(e)
      toast.update(id, { type: 'error', text: errMsg(e), sticky: false })
      return null
    } finally {
      setBusy(null)
    }
  }, [toast, net])
  return { run, busy }
}

/** Small async-data hook: { data, loading, error, reload }. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: undefined, loading: true, error: '' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps)
  const reload = useCallback(async () => {
    setState(s => ({ ...s, loading: s.data === undefined, error: '' }))
    try { setState({ data: await load(), loading: false, error: '' }) }
    catch (e) { console.error(e); setState(s => ({ ...s, loading: false, error: errMsg(e) })) }
  }, [load])
  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}

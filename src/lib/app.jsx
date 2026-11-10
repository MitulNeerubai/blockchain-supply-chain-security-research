import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getContracts, loadDirectory } from './chain'
import { errMsg, short } from './format'
import { useToast } from '../components/ui'

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

// ── Session: connected wallet + identity ────────────────────────────────────
const SessionCtx = createContext(null)
export function SessionProvider({ session, children }) {
  const value = useMemo(() => session && ({ ...session, write: getContracts(session.signer) }), [session])
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}
export const useSession = () => useContext(SessionCtx)

// ── Transactions with toast feedback ────────────────────────────────────────
export function useTx() {
  const toast = useToast()
  const [busy, setBusy] = useState(null)
  const run = useCallback(async (key, send, { pending = 'Waiting for the block to confirm…', success = 'Transaction confirmed.', onDone } = {}) => {
    setBusy(key)
    const id = toast.show({ type: 'pending', text: 'Confirm the transaction in MetaMask…', sticky: true })
    try {
      const tx = await send()
      toast.update(id, { text: pending, sticky: true })
      const receipt = await tx.wait()
      toast.update(id, { type: 'success', text: success, sticky: false })
      await onDone?.(receipt)
      return receipt
    } catch (e) {
      console.error(e)
      toast.update(id, { type: 'error', text: errMsg(e), sticky: false })
      return null
    } finally {
      setBusy(null)
    }
  }, [toast])
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

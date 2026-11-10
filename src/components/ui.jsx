import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { short, ROLE_LABEL } from '../lib/format'
import { useNetwork, useProfile } from '../lib/app'

export function Spinner({ lg }) { return <span className={`spinner${lg ? ' lg' : ''}`} /> }

export function Button({ variant = 'primary', size, block, loading, children, className = '', ...rest }) {
  const cls = ['btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ')
  return (
    <button className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading && <Spinner />}{children}
    </button>
  )
}

export function Card({ title, subtitle, actions, children, bodyClass = '', flushHead, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className={`card-head${flushHead ? ' flush' : ''}`}>
          <div className="grow">
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${bodyClass}`}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

const ALERT_ICON = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '⛔' }
export function Alert({ type = 'info', title, children, action }) {
  return (
    <div className={`alert alert-${type}`}>
      <span className="alert-icon">{ALERT_ICON[type]}</span>
      <div className="grow">
        {title && <div className="alert-title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function Pill({ tone = 'gray', dot, children }) {
  return <span className={`badge pill-${tone}${dot ? ' pill-dot' : ''}`}>{children}</span>
}

export function RoleBadge({ role }) {
  if (!role) return null
  return <span className="badge badge-role" style={{ background: `var(--role-${role}, #475467)` }}>{ROLE_LABEL[role] || role}</span>
}

const CRED_TONE = { active: ['green', 'Active'], suspended: ['amber', 'Suspended'], revoked: ['red', 'Revoked'], expired: ['gray', 'Expired'] }
export function CredPill({ status }) {
  const [tone, label] = CRED_TONE[status] || ['gray', status]
  return <Pill tone={tone} dot>{label}</Pill>
}

export function Empty({ icon = '📭', title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      {title && <div className="empty-title">{title}</div>}
      {children && <div className="small" style={{ marginTop: 4 }}>{children}</div>}
    </div>
  )
}

export function Loading({ children = 'Loading…' }) {
  return <div className="loading-block"><Spinner /> {children}</div>
}

export function Field({ label, hint, error, ok, children }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
      {error ? <span className="field-error">{error}</span> : ok ? <span className="field-ok">{ok}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" className={`tab${value === t.id ? ' active' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon && <span>{t.icon}</span>}{t.label}
          {t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, width }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="card-title">{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button" className="icon-btn" title={label}
      onClick={e => { e.preventDefault(); e.stopPropagation(); navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}
    >{done ? '✓' : '⧉'}</button>
  )
}

/** Coloured dot for a licence / actor state. */
const DOT_TITLE = { active: 'Active', pending: 'Pending', suspended: 'Suspended', revoked: 'Revoked', expired: 'Expired', unknown: 'Unknown' }
export function StatusDot({ state, title }) {
  return <span className={`sdot sdot-${state || 'unknown'}`} title={title || DOT_TITLE[state] || state} aria-label={title || DOT_TITLE[state]} />
}

/** Company name + role colour + live licence dot. Click opens the company profile. */
export function Entity({ address, name, role, sub, size = 34, noLink, noStatus }) {
  const net = useNetwork()
  const profile = useProfile()
  const label = name || short(address)
  const st = !noStatus && address ? net?.statusOf(address) : null
  const clickable = !noLink && address
  const Tag = clickable ? 'button' : 'div'
  return (
    <div className="entity">
      <div className="avatar" style={{ width: size, height: size, background: role ? `var(--role-${role})` : undefined }}>
        {(label || '?').replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?'}
        {st && <StatusDot state={st.state} title={st.label} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <Tag type={clickable ? 'button' : undefined} className={`entity-name${clickable ? ' link' : ''}`} onClick={clickable ? () => profile.open(address) : undefined} title={clickable ? 'Open company profile' : undefined}>
          {label}
        </Tag>
        <div className="entity-addr">{sub ?? <>{short(address)}<CopyButton text={address} label="Copy address" /></>}</div>
      </div>
    </div>
  )
}

/** Inline company link (name only) that opens the profile. */
export function CompanyLink({ address, children }) {
  const profile = useProfile()
  if (!address) return children ?? null
  return <button type="button" className="link-btn" onClick={() => profile.open(address)}>{children}</button>
}

// ── Toasts ──────────────────────────────────────────────────────────────────
const ToastCtx = createContext(null)
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const seq = useRef(0)
  const timers = useRef({})
  const dismiss = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), [])
  const schedule = useCallback((id, sticky) => {
    clearTimeout(timers.current[id])
    if (!sticky) timers.current[id] = setTimeout(() => dismiss(id), 5000)
  }, [dismiss])
  const show = useCallback(({ type = 'info', text, sticky }) => {
    const id = ++seq.current
    setToasts(t => [...t, { id, type, text }])
    schedule(id, sticky)
    return id
  }, [schedule])
  const update = useCallback((id, patch) => {
    setToasts(t => t.map(x => (x.id === id ? { ...x, ...patch } : x)))
    schedule(id, patch.sticky)
  }, [schedule])
  const api = useMemo(() => ({ show, update, dismiss }), [show, update, dismiss])
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.type === 'pending' ? <Spinner /> : t.type === 'success' ? '✓' : t.type === 'error' ? '!' : 'i'}</span>
            <span className="grow">{t.text}</span>
            <button className="icon-btn" onClick={() => dismiss(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

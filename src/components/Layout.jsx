import { CHAIN_NAME, IS_BESU } from '../lib/chain'
import { go, useRoute, useWallet } from '../lib/app'
import { ROLE_ICON, ROLE_LABEL, short } from '../lib/format'
import { CopyButton, RoleBadge } from './ui'

const NAV = [
  ['home', '/', 'Overview'],
  ['products', '/products', 'Products'],
  ['companies', '/companies', 'Companies'],
  ['guide', '/guide', 'How it works'],
  ['verify', '/verify', 'Verify'],
]

export function TopBar() {
  const route = useRoute()
  const w = useWallet()
  const s = w.session
  const inApp = route.page === 'app'
  const active = route.page === 'product' ? 'products' : route.page
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#/">
          <div className="brand-mark">🔗</div>
          <div>DIDLab Supply Chain<small>Self-sovereign identity · traceability</small></div>
        </a>
        <nav className="topnav" aria-label="Public pages">
          {NAV.map(([id, path, label]) => (
            <a key={id} href={'#' + path} className={`topnav-link${active === id ? ' active' : ''}`}>{label}</a>
          ))}
        </nav>
        <div className="topbar-spacer" />
        <span className="net-pill" title={IS_BESU ? 'Chain ID 252501' : 'Local development chain'}>
          <span className={`dot${IS_BESU ? '' : ' warn'}`} />{CHAIN_NAME}
        </span>
        {s ? (
          <>
            {!inApp && <button className="btn btn-primary btn-sm" onClick={() => go('/app')}>My dashboard →</button>}
            <div className="user-chip" title={s.role ? ROLE_LABEL[s.role] : 'Not registered'}>
              <div className="avatar" style={{ background: s.role ? `var(--role-${s.role})` : undefined }}>{ROLE_ICON[s.role] || '👤'}</div>
              <div className="user-chip-text">
                <div className="user-chip-name">{s.company || 'Not registered'}</div>
                <div className="user-chip-addr">{short(s.address)} <CopyButton text={s.address} /></div>
              </div>
            </div>
            <button className="btn-ghost-dark" onClick={() => { w.disconnect(); go('/') }}>Sign out</button>
          </>
        ) : (
          !inApp && <button className="btn btn-primary btn-sm" onClick={() => go('/app')}>🦊 Participant sign-in</button>
        )}
      </div>
    </header>
  )
}

export function PageHead({ session, title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <div className="row" style={{ gap: 10 }}>
          <h1 className="page-title">{title}</h1>
          {session?.role && <RoleBadge role={session.role} />}
        </div>
        <p className="page-sub">{subtitle || (session?.did ? <span className="mono small">{session.did}</span> : ROLE_LABEL[session?.role])}</p>
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  )
}

/** Dashboard frame: sticky sidebar (onboarding + trust path) next to the main content. */
export function DashLayout({ side, children }) {
  return (
    <div className="page dash">
      <aside className="dash-side">{side}</aside>
      <div className="dash-main">{children}</div>
    </div>
  )
}

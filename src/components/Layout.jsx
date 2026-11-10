import { CHAIN_NAME, IS_BESU } from '../lib/chain'
import { ROLE_ICON, ROLE_LABEL, short } from '../lib/format'
import { CopyButton, RoleBadge } from './ui'

export function TopBar({ session, onDisconnect }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div className="brand-mark">🔗</div>
          <div>DIDLab Supply Chain<small>Self-sovereign identity · traceability</small></div>
        </div>
        <div className="topbar-spacer" />
        <span className="net-pill" title={IS_BESU ? 'Chain ID 252501' : 'Local development chain'}>
          <span className={`dot${IS_BESU ? '' : ' warn'}`} />{CHAIN_NAME}
        </span>
        {session && (
          <>
            <div className="user-chip">
              <div className="avatar" style={{ background: session.role ? `var(--role-${session.role})` : undefined }}>
                {ROLE_ICON[session.role] || '👤'}
              </div>
              <div style={{ paddingRight: 6 }}>
                <div className="user-chip-name">{session.company || 'Not registered'}</div>
                <div className="user-chip-addr">{short(session.address)} <CopyButton text={session.address} /></div>
              </div>
            </div>
            <button className="btn-ghost-dark" onClick={onDisconnect}>Disconnect</button>
          </>
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

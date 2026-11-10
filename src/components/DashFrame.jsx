import { useSession } from '../lib/app'
import { DashLayout } from './Layout'
import { GettingStarted, WelcomeModal, useWelcome } from './Onboarding'
import { TrustPath } from './Network'

/**
 * Every dashboard: sidebar with the live "Getting started" checklist and the
 * wallet's place in the trust chain, plus the first-visit welcome pop-up.
 * `facts` drive the checklist ticks; `onGo(tab)` switches the dashboard tab.
 */
export default function DashFrame({ facts, onGo, children }) {
  const s = useSession()
  const welcome = useWelcome(s.address, s.role)
  const ready = facts && !facts.loading
  return (
    <DashLayout side={
      <>
        <GettingStarted role={s.role} facts={facts} onGo={onGo} onShowWelcome={welcome.open} />
        <section className="card side-card">
          <div className="side-title" style={{ marginBottom: 10 }}>Your place in the trust chain</div>
          <TrustPath address={s.address} />
        </section>
        <section className="card side-card side-links">
          <a href="#/guide">📘 How it works — full guide</a>
          <a href="#/companies">🏢 All companies & trust map</a>
          <a href="#/products">📦 All products (public)</a>
        </section>
      </>
    }>
      {children}
      {welcome.show && ready && <WelcomeModal role={s.role} company={s.company} facts={facts} onClose={welcome.close} onGo={onGo} />}
    </DashLayout>
  )
}

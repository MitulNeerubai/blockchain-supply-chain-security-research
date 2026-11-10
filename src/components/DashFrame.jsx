import { useSession } from '../lib/app'
import { progress } from '../lib/guide'
import { GettingStartedBar, WelcomeModal, useWelcome } from './Onboarding'
import { TrustPath } from './Network'

/**
 * Every dashboard: full-width page with a "Getting started" bar on top
 * (live checklist + the wallet's place in the trust chain) and the
 * first-visit welcome pop-up. `facts` drive the checklist ticks;
 * `onGo(tab)` switches the dashboard tab.
 */
export default function DashFrame({ facts, onGo, children }) {
  const s = useSession()
  const welcome = useWelcome(s.address, s.role)
  const ready = facts && !facts.loading
  // Don't pop the welcome guide on companies that already finished every step
  // (it can still be opened with the “?” button).
  const pr = ready ? progress(s.role, facts) : null
  const autoShow = welcome.show && ready && (welcome.manual || pr.done < pr.total)
  return (
    <div className="page">
      <GettingStartedBar role={s.role} facts={facts} onGo={onGo} onShowWelcome={welcome.open} address={s.address}
        extra={
          <div className="gs-trust">
            <div className="field-label" style={{ marginBottom: 8 }}>Your place in the trust chain</div>
            <TrustPath address={s.address} />
          </div>
        } />
      {children}
      {autoShow && <WelcomeModal role={s.role} company={s.company} facts={facts} onClose={welcome.close} onGo={onGo} />}
    </div>
  )
}

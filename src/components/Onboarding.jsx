import { useCallback, useState } from 'react'
import { ROLE_GUIDE, progress } from '../lib/guide'
import { ROLE_ICON, ROLE_LABEL } from '../lib/format'
import { Button, Modal } from './ui'

const key = (address, role) => `sc_welcome_${role}_${(address || '').toLowerCase()}`
const seen = k => { try { return localStorage.getItem(k) === '1' } catch { return true } }
const markSeen = k => { try { localStorage.setItem(k, '1') } catch { /* storage blocked */ } }

/** Welcome pop-up: shown automatically the first time a wallet opens its dashboard. */
export function useWelcome(address, role) {
  const k = key(address, role)
  const [show, setShow] = useState(() => !!address && !!role && !seen(k))
  const [manual, setManual] = useState(false)
  const open = useCallback(() => { setManual(true); setShow(true) }, [])
  const close = useCallback(() => { markSeen(k); setShow(false); setManual(false) }, [k])
  return { show, manual, open, close }
}

function StepBody({ s }) {
  return (
    <div className="step-body">
      <div><b>What you do:</b> {s.do}</div>
      <div className="faint"><b>What happens on-chain:</b> {s.happens}</div>
    </div>
  )
}

export function WelcomeModal({ role, company, facts, onClose, onGo }) {
  const g = ROLE_GUIDE[role]
  const pr = progress(role, facts)
  if (!g) return null
  return (
    <Modal title={`${ROLE_ICON[role]} Welcome${company ? `, ${company}` : ''}`} onClose={onClose} width={620}>
      <div className="stack">
        <p className="muted">{g.intro}</p>
        <div className="field-label">Here is what happens next, step by step:</div>
        <ol className="onb-list">
          {pr.steps.map((s, i) => (
            <li key={s.id} className={`onb-item${s.isDone ? ' done' : ''}${i === pr.next ? ' next' : ''}`}>
              <span className="onb-num">{s.isDone ? '✓' : i + 1}</span>
              <div className="grow">
                <div className="onb-title">{s.title}{s.optional && <span className="faint small"> · optional</span>}{i === pr.next && <span className="badge pill-blue" style={{ marginLeft: 8 }}>Next</span>}</div>
                <StepBody s={s} />
              </div>
            </li>
          ))}
        </ol>
        <p className="faint small">This checklist stays in the “Getting started” bar at the top of your dashboard and ticks itself off as you go. The full guide is under “How it works” at the top.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <a className="btn btn-ghost" href="#/guide" onClick={onClose}>Open full guide</a>
          {pr.next >= 0 && pr.steps[pr.next].tab
            ? <Button onClick={() => { onClose(); onGo?.(pr.steps[pr.next].tab) }}>Start: {pr.steps[pr.next].title} →</Button>
            : <Button onClick={onClose}>Got it</Button>}
        </div>
      </div>
    </Modal>
  )
}

/** Sidebar checklist that ticks itself off from live chain data. */
export function GettingStarted({ role, facts, onGo, onShowWelcome }) {
  const pr = progress(role, facts)
  const [open, setOpen] = useState(null)
  if (!pr.steps.length) return null
  const allDone = pr.done === pr.total
  const pct = Math.round((pr.done / Math.max(1, pr.total)) * 100)
  return (
    <section className="card side-card">
      <div className="side-head">
        <div className="grow">
          <div className="side-title">{allDone ? '🎉 All set' : 'Getting started'}</div>
          <div className="faint small">{pr.done} of {pr.total} steps done</div>
        </div>
        {onShowWelcome && <button className="icon-btn" title="Show the welcome guide" onClick={onShowWelcome}>?</button>}
      </div>
      <div className="progress"><span style={{ width: pct + '%' }} /></div>
      <ol className="side-steps">
        {pr.steps.map((s, i) => {
          const expanded = open === s.id || (open === null && i === pr.next)
          return (
            <li key={s.id} className={`side-step${s.isDone ? ' done' : ''}${i === pr.next ? ' next' : ''}`}>
              <button type="button" className="side-step-head" onClick={() => setOpen(expanded ? '' : s.id)}>
                <span className="onb-num">{s.isDone ? '✓' : i + 1}</span>
                <span className="grow">{s.title}{s.optional && <span className="faint"> · optional</span>}</span>
                <span className="faint">{expanded ? '▾' : '▸'}</span>
              </button>
              {expanded && (
                <div className="side-step-body">
                  <StepBody s={s} />
                  {s.tab && !s.isDone && onGo && <Button size="sm" style={{ marginTop: 8 }} onClick={() => onGo(s.tab)}>Go →</Button>}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** Full-width progress bar at the top of every dashboard (replaces the old sidebar). */
export function GettingStartedBar({ role, facts, onGo, onShowWelcome, address, extra }) {
  const pr = progress(role, facts)
  const k = `sc_gsbar_${(address || '').toLowerCase()}`
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(k) === 'open' } catch { return false } })
  const toggle = () => setOpen(v => { try { localStorage.setItem(k, v ? 'closed' : 'open') } catch { /* blocked */ } return !v })
  if (!pr.steps.length) return null
  const allDone = pr.done === pr.total
  const pct = Math.round((pr.done / Math.max(1, pr.total)) * 100)
  const next = pr.next >= 0 ? pr.steps[pr.next] : null
  return (
    <section className={`card gs-bar${allDone ? ' done' : ''}`}>
      <div className="gs-main">
        <div className="gs-progress">
          <div className="strong small">{allDone ? '🎉 All set' : 'Getting started'}</div>
          <div className="progress"><span style={{ width: pct + '%' }} /></div>
          <div className="faint tiny">{pr.done} of {pr.total} steps</div>
        </div>
        <div className="gs-next grow">
          {next ? <>
            <div className="small"><span className="badge pill-blue">Next</span> <b>{next.title}</b></div>
            <div className="faint small">{next.do}</div>
          </> : <div className="small muted">Every setup step is done. Expand to see what each step did on-chain and your place in the trust chain.</div>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {next?.tab && onGo && <Button size="sm" onClick={() => onGo(next.tab)}>Go →</Button>}
          <Button variant="ghost" size="sm" onClick={toggle}>{open ? 'Hide steps ▴' : 'All steps ▾'}</Button>
          {onShowWelcome && <button className="icon-btn gs-help" title="Show the welcome guide" onClick={onShowWelcome}>?</button>}
        </div>
      </div>
      {open && (
        <div className="gs-detail">
          <ol className="gs-steps">
            {pr.steps.map((s, i) => (
              <li key={s.id} className={`onb-item${s.isDone ? ' done' : ''}${i === pr.next ? ' next' : ''}`}>
                <span className="onb-num">{s.isDone ? '✓' : i + 1}</span>
                <div className="grow">
                  <div className="onb-title">{s.title}{s.optional && <span className="faint small"> · optional</span>}</div>
                  <StepBody s={s} />
                  {s.tab && !s.isDone && onGo && <Button size="sm" variant="secondary" style={{ marginTop: 8 }} onClick={() => onGo(s.tab)}>Go →</Button>}
                </div>
              </li>
            ))}
          </ol>
          {extra}
        </div>
      )}
    </section>
  )
}

/** Compact "after you register…" preview on the Register page. */
export function NextSteps({ role }) {
  const g = ROLE_GUIDE[role]
  if (!g) return null
  return (
    <div className="next-steps">
      <div className="field-label" style={{ marginBottom: 6 }}>After you register as {ROLE_LABEL[role]}:</div>
      <ol className="onb-list compact">
        {g.steps.slice(1).map((s, i) => (
          <li key={s.id} className="onb-item">
            <span className="onb-num">{i + 2}</span>
            <div className="grow"><div className="onb-title">{s.title}</div><div className="faint small">{s.do}</div></div>
          </li>
        ))}
      </ol>
    </div>
  )
}

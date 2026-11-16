import { useState } from 'react'
import { go, useDirectory, useNetwork } from '../lib/app'
import { Button } from '../components/ui'
import { useAllProducts } from './AllProducts'

/** Landing page: one job - check a product. Everything else is one click away in the top bar. */
export default function Home() {
  const d = useDirectory()
  const net = useNetwork()
  const products = useAllProducts()
  const [id, setId] = useState('')
  const [err, setErr] = useState('')
  const list = products.data || []
  const companies = [...d.dir.values()]

  function verify(e) {
    e.preventDefault()
    const n = id.trim().replace(/^#/, '')
    if (!/^\d+$/.test(n) || n === '0') { setErr('Enter the product number printed on the label, for example 12.'); return }
    go('/product/' + n)
  }

  const stats = [
    ['Products tracked', products.data ? list.filter(p => p.status !== 3).length : '…', '/products'],
    ['Delivered to stores', products.data ? list.filter(p => p.status === 2).length : '…', '/products'],
    ['Licensed companies', d.loading || !net.ready ? '…' : companies.filter(c => net.statusOf(c.address).state === 'active').length, '/companies'],
  ]

  return (
    <div className="page home">
      <section className="home-hero">
        <h1 className="hero-title">Is this product genuine?</h1>
        <p className="hero-sub">Check where a product came from and every company that handled it. No account needed.</p>

        <form className="home-verify" onSubmit={verify} noValidate>
          <input className={`input home-input${err ? ' invalid' : ''}`} inputMode="numeric" autoFocus aria-label="Product number"
            placeholder="Product number" value={id} onChange={e => { setId(e.target.value); setErr('') }} />
          <Button type="submit" size="lg">Verify</Button>
        </form>
        {err ? <p className="field-error home-note">{err}</p>
          : <p className="faint small home-note">Have a QR code on the label? Point your phone camera at it and the result opens by itself.</p>}
      </section>

      <div className="home-stats">
        {stats.map(([label, value, path]) => (
          <a key={label} className="home-stat" href={'#' + path}>
            <span className="home-stat-value">{value}</span>
            <span className="home-stat-label">{label}</span>
          </a>
        ))}
      </div>

      <p className="home-links">
        <a href="#/products">Browse products</a><span>·</span>
        <a href="#/companies">Companies</a><span>·</span>
        <a href="#/guide">How it works</a>
      </p>
    </div>
  )
}

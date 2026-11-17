import { useState } from 'react'
import { fetchDecryptedJSON } from '../lib/ipfs'
import { useSession } from '../lib/app'
import { Alert, Button, Modal } from './ui'

/** Parse the on-chain ipfsCID pointer: JSON { cid, iv, ts }. Returns null if there is none. */
export function parsePointer(ipfsCID) {
  if (!ipfsCID) return null
  try {
    const o = JSON.parse(ipfsCID)
    return o && o.cid ? { cid: o.cid, iv: o.iv, timestamp: o.ts } : null
  } catch {
    return null
  }
}

/**
 * Shows a product's encrypted off-chain record (stored on DIDLab Secure IPFS when
 * the product was created). Only the CID is on-chain; the creating wallet signs to decrypt.
 */
export function RecordModal({ product, onClose }) {
  const s = useSession()
  const ref = parsePointer(product.ipfsCID)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function reveal() {
    setErr(''); setLoading(true)
    try { setData(await fetchDecryptedJSON(s.signer, ref)) }
    catch { setErr('Could not decrypt. Only the wallet that created this product can read its IPFS record.') }
    finally { setLoading(false) }
  }

  return (
    <Modal title={`IPFS record — ${product.name} #${product.id}`} onClose={onClose} width={520}>
      <div className="stack">
        {!ref ? (
          <Alert type="info">This product has no off-chain IPFS record.</Alert>
        ) : !data ? (
          <>
            <p className="muted small">
              This product's details are stored <b>encrypted on DIDLab Secure IPFS</b>; only the CID is kept on-chain.
              Sign with the creating wallet to decrypt and view them.
            </p>
            <div className="copy-box">CID: {ref.cid}</div>
            {err && <Alert type="error">{err}</Alert>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={reveal} loading={loading}>🔓 Decrypt &amp; view</Button>
            </div>
          </>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {Object.entries(data).map(([k, v]) => (
              <div className="kv-item" key={k} style={{ minWidth: 0 }}>
                <div className="kv-k">{k}</div>
                <div className="kv-v">{String(v)}</div>
              </div>
            ))}
            <p className="faint small">Decrypted locally from IPFS · CID {ref.cid}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

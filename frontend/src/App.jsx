import { useState, useEffect } from 'react'
import {
  connectWallet, createWill, pingWill, topUpWill, revokeWill, claimWill,
  getWill, getOwnerWills, getBeneficiaryWills, getTimeUntilClaimable, getWillCount,
  xlm, short, ledgersToTime, CONTRACT_ID,
} from './lib/stellar'

// ── Countdown ring ─────────────────────────────────────────────────────────
function CountdownRing({ ledgersLeft, interval }) {
  const pct    = interval > 0 ? Math.max(0, ledgersLeft / interval) : 0
  const r      = 50, circ = 2 * Math.PI * r
  const dash   = pct * circ
  const urgent = pct < 0.25
  const dead   = ledgersLeft === 0

  return (
    <div className="cr-wrap">
      <svg width="116" height="116" viewBox="0 0 116 116">
        <circle cx="58" cy="58" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7"/>
        <circle cx="58" cy="58" r={r} fill="none"
          stroke={dead ? '#ef4444' : urgent ? '#f59e0b' : '#10b981'}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ * 0.25}
          style={{ transition: 'stroke-dasharray 0.6s ease', filter: dead ? 'drop-shadow(0 0 8px #ef4444)' : undefined }}
        />
      </svg>
      <div className="cr-inner">
        {dead
          ? <div className="cr-dead">EXPIRED</div>
          : <>
              <div className="cr-time">{ledgersToTime(ledgersLeft)}</div>
              <div className="cr-sub">remaining</div>
            </>
        }
      </div>
    </div>
  )
}

// ── Will card (owner view) ─────────────────────────────────────────────────
function WillCard({ willId, wallet, currentLedger, isBeneficiary, onAction }) {
  const [will,      setWill]      = useState(null)
  const [timeLeft,  setTimeLeft]  = useState(0)
  const [expanded,  setExpanded]  = useState(false)
  const [topUpAmt,  setTopUpAmt]  = useState('5')
  const [busy,      setBusy]      = useState(false)
  const [showTopUp, setShowTopUp] = useState(false)

  useEffect(() => {
    getWill(willId).then(w => {
      setWill(w)
      if (w) getTimeUntilClaimable(willId).then(setTimeLeft)
    })
  }, [willId])

  if (!will) return <div className="will-skeleton"/>

  const isOwner    = wallet && will.owner?.toString() === wallet
  const isBenef    = wallet && will.beneficiary?.toString() === wallet
  const isActive   = will.status === 'Active'
  const claimable  = isActive && timeLeft === 0

  const handle = async (fn, msg) => {
    setBusy(true)
    try {
      const hash = await fn()
      onAction({ ok: true, msg, hash, refresh: true })
    } catch (e) { onAction({ ok: false, msg: e.message }) }
    finally { setBusy(false) }
  }

  const statusLabel = {
    Active:    claimable ? '⚠ CLAIMABLE' : '● ACTIVE',
    Triggered: '⚠ TRIGGERED',
    Claimed:   '✓ CLAIMED',
    Revoked:   '✗ REVOKED',
  }[will.status] || will.status

  const statusCls = {
    Active:    claimable ? 'ws-claimable' : 'ws-active',
    Triggered: 'ws-claimable',
    Claimed:   'ws-claimed',
    Revoked:   'ws-revoked',
  }[will.status] || ''

  return (
    <div className={`will-card ${claimable ? 'wc-claimable' : ''} ${will.status === 'Revoked' || will.status === 'Claimed' ? 'wc-done' : ''}`}>
      <div className="wc-header">
        <div className="wc-meta">
          <span className={`will-status ${statusCls}`}>{statusLabel}</span>
          <span className="wc-id">WILL #{willId.toString().padStart(4,'0')}</span>
        </div>
        <CountdownRing ledgersLeft={timeLeft} interval={Number(will.check_interval)} />
      </div>

      <h3 className="wc-title">{will.title}</h3>

      <div className="wc-parties">
        <div className="wcp">
          <span className="wcp-role">OWNER</span>
          <span className="wcp-addr">{short(will.owner)}{isOwner ? ' (you)' : ''}</span>
        </div>
        <div className="wcp-arrow">→</div>
        <div className="wcp">
          <span className="wcp-role">BENEFICIARY</span>
          <span className="wcp-addr">{short(will.beneficiary)}{isBenef ? ' (you)' : ''}</span>
        </div>
      </div>

      <div className="wc-stats">
        <div className="wcs"><span className="wcs-n">{xlm(will.balance)}</span><span className="wcs-l">XLM locked</span></div>
        <div className="wcs-div"/>
        <div className="wcs"><span className="wcs-n">{ledgersToTime(Number(will.check_interval))}</span><span className="wcs-l">check-in window</span></div>
        <div className="wcs-div"/>
        <div className="wcs"><span className="wcs-n">{will.ping_count?.toString()}</span><span className="wcs-l">pings sent</span></div>
      </div>

      {expanded && will.note && (
        <div className="wc-note-block">
          <div className="wc-note-label">MESSAGE TO BENEFICIARY</div>
          <div className="wc-note-text">"{will.note}"</div>
        </div>
      )}

      <button className="btn-expand" onClick={() => setExpanded(e => !e)}>
        {expanded ? '▲ Hide message' : '▼ Show message'}
      </button>

      {/* Outcome banners */}
      {will.status === 'Claimed' && (
        <div className="outcome-banner ob-claimed">✓ Funds claimed by beneficiary.</div>
      )}
      {will.status === 'Revoked' && (
        <div className="outcome-banner ob-revoked">✗ Will revoked. Funds returned to owner.</div>
      )}

      {/* Owner actions */}
      {isOwner && isActive && (
        <div className="wc-actions">
          <button className="btn-ping" disabled={busy}
            onClick={() => handle(() => pingWill(wallet, willId), '✓ Pinged! Timer reset.')}>
            {busy ? '…' : '❤ I\'m Alive — Reset Timer'}
          </button>
          <button className="btn-topup-toggle" onClick={() => setShowTopUp(t => !t)}>
            + Top Up
          </button>
          <button className="btn-revoke-will" disabled={busy}
            onClick={() => handle(() => revokeWill(wallet, willId), 'Will revoked. Funds returned.')}>
            Revoke
          </button>
        </div>
      )}

      {showTopUp && isOwner && isActive && (
        <div className="topup-panel">
          <input type="number" min="0.1" step="0.1"
            value={topUpAmt} onChange={e => setTopUpAmt(e.target.value)}
            className="tp-input" disabled={busy} />
          <span className="tp-unit">XLM</span>
          <button className="btn-do-topup" disabled={busy || !topUpAmt}
            onClick={() => handle(() => topUpWill(wallet, willId, parseFloat(topUpAmt)),
              `Added ${topUpAmt} XLM to will.`)}>
            {busy ? '…' : 'Add Funds'}
          </button>
        </div>
      )}

      {/* Beneficiary claim */}
      {isBenef && claimable && !['Claimed','Revoked'].includes(will.status) && (
        <button className="btn-claim-will" disabled={busy}
          onClick={() => handle(() => claimWill(wallet, willId),
            `Claimed ${xlm(will.balance)} XLM from will #${willId}`)}>
          {busy ? 'Claiming…' : `⚰ Claim Inheritance — ${xlm(will.balance)} XLM`}
        </button>
      )}
    </div>
  )
}

// ── Create will form ───────────────────────────────────────────────────────
function CreateWillForm({ wallet, onCreated }) {
  const [beneficiary, setBeneficiary] = useState('')
  const [title,       setTitle]       = useState('')
  const [note,        setNote]        = useState('')
  const [amount,      setAmount]      = useState('10')
  const [days,        setDays]        = useState('30')
  const [busy,        setBusy]        = useState(false)
  const [err,         setErr]         = useState('')

  const intervalLedgers = Math.round(parseFloat(days || 1) * 17_280)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const hash = await createWill(wallet, beneficiary, title, note,
        parseFloat(amount), intervalLedgers)
      onCreated(hash)
      setBeneficiary(''); setTitle(''); setNote(''); setAmount('10')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <div className="cf-ornament">— NEW WILL —</div>

      <div className="cf-field">
        <label>TITLE</label>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="e.g. My Stellar Inheritance"
          maxLength={60} required disabled={busy} />
      </div>
      <div className="cf-field">
        <label>BENEFICIARY ADDRESS</label>
        <input value={beneficiary} onChange={e => setBeneficiary(e.target.value)}
          placeholder="G… — who inherits if you stop checking in"
          required disabled={busy} />
      </div>
      <div className="cf-field">
        <label>MESSAGE TO BENEFICIARY</label>
        <textarea value={note} onChange={e => setNote(e.target.value)}
          placeholder="Leave a note for them to find…"
          maxLength={200} rows={3} disabled={busy} />
        <span className="cf-chars">{note.length}/200</span>
      </div>
      <div className="cf-row">
        <div className="cf-field">
          <label>AMOUNT (XLM)</label>
          <div className="amt-presets">
            {['5','10','25','50','100'].map(v => (
              <button key={v} type="button"
                className={`amp ${amount === v ? 'amp-active' : ''}`}
                onClick={() => setAmount(v)}>{v}</button>
            ))}
          </div>
          <input type="number" min="1" step="1"
            value={amount} onChange={e => setAmount(e.target.value)}
            className="cf-num" required disabled={busy} />
        </div>
        <div className="cf-field">
          <label>CHECK-IN WINDOW</label>
          <div className="dur-row">
            {['7','14','30','60','90'].map(d => (
              <button key={d} type="button"
                className={`dur-btn ${days === d ? 'dur-active' : ''}`}
                onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
          <span className="cf-hint">You must ping at least once every {days} days or your beneficiary can claim.</span>
        </div>
      </div>
      {err && <p className="cf-err">{err}</p>}
      <button type="submit" className="btn-create-will"
        disabled={busy || !title || !beneficiary}>
        {busy ? 'Signing…' : `⚰ Create Will — Lock ${amount} XLM`}
      </button>
    </form>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function App() {
  const [wallet,        setWallet]        = useState(null)
  const [tab,           setTab]           = useState('mywills')
  const [ownerIds,      setOwnerIds]      = useState([])
  const [benefIds,      setBenefIds]      = useState([])
  const [willCount,     setWillCount]     = useState(0)
  const [currentLedger, setCurrentLedger] = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [toast,         setToast]         = useState(null)
  const [lookupId,      setLookupId]      = useState('')
  const [lookupResult,  setLookupResult]  = useState(null)

  const loadAll = async (addr) => {
    setLoading(true)
    try {
      const count = await getWillCount()
      setWillCount(count)
      if (addr) {
        const [o, b] = await Promise.all([getOwnerWills(addr), getBeneficiaryWills(addr)])
        setOwnerIds(o); setBenefIds(b)
      }
      try {
        const resp = await fetch(
          (import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org').trim(),
          { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({jsonrpc:'2.0',id:1,method:'getLedgers',params:{limit:1}}) }
        ).then(r => r.json())
        if (resp.result?.ledgers?.[0]?.sequence) setCurrentLedger(resp.result.ledgers[0].sequence)
      } catch {}
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadAll(null) }, [])

  const handleConnect = async () => {
    try {
      const addr = await connectWallet()
      setWallet(addr)
      loadAll(addr)
    } catch (e) { showToast(false, e.message) }
  }

  const showToast = (ok, msg, hash) => {
    setToast({ ok, msg, hash })
    setTimeout(() => setToast(null), 6000)
  }

  const handleAction = ({ ok, msg, hash, refresh }) => {
    showToast(ok, msg, hash)
    if (ok && refresh && wallet) loadAll(wallet)
  }

  const handleCreated = (hash) => {
    showToast(true, 'Will created and sealed on-chain.', hash)
    setTab('mywills')
    if (wallet) loadAll(wallet)
  }

  const handleLookup = async (e) => {
    e.preventDefault()
    try {
      const w = await getWill(parseInt(lookupId))
      setLookupResult(w)
    } catch { showToast(false, 'Will not found') }
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="brand">
          <div className="brand-urn">⚰</div>
          <div>
            <div className="brand-name">ChainWill</div>
            <div className="brand-sub">on-chain inheritance · dead man's switch · stellar</div>
          </div>
        </div>

        <div className="header-stats">
          <div className="hs"><span className="hs-n">{willCount}</span><span className="hs-l">WILLS CREATED</span></div>
        </div>

        <div className="header-right">
          <div className="tabs-inline">
            {[
              { id:'mywills',   label:'My Wills'  },
              { id:'inherit',   label:'Inherited' },
              { id:'create',    label:'+ New Will' },
              { id:'lookup',    label:'Look Up'   },
            ].map(t => (
              <button key={t.id}
                className={`tab-btn ${tab === t.id ? 'tab-active' : ''}`}
                onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {wallet
            ? <div className="wallet-pill"><span className="wdot"/>{short(wallet)}</div>
            : <button className="btn-connect" onClick={handleConnect}>Connect</button>
          }
        </div>
      </header>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
          <span>{toast.msg}</span>
          {toast.hash && <a href={`https://stellar.expert/explorer/testnet/tx/${toast.hash}`} target="_blank" rel="noreferrer" className="toast-link">TX ↗</a>}
        </div>
      )}

      <main className="main">
        {/* ── My Wills ── */}
        {tab === 'mywills' && (
          !wallet ? (
            <div className="landing">
              <div className="lnd-urn">⚰</div>
              <h1 className="lnd-title">Leave something behind.</h1>
              <p className="lnd-sub">Lock XLM for your heirs. Check in regularly to prove you're alive. Miss the deadline — your beneficiary inherits. Enforced entirely on-chain by Soroban.</p>
              <div className="lnd-steps">
                {[
                  ['Create a will', 'Lock XLM, name a beneficiary, set your check-in window'],
                  ['Ping regularly', 'Sign a transaction any time before your deadline expires'],
                  ['Miss the deadline', 'Your beneficiary can claim the full balance'],
                  ['Or revoke anytime', 'Owner can always withdraw their own funds while active'],
                ].map(([title, desc], i) => (
                  <div key={i} className="lnd-step">
                    <div className="lnd-n">0{i+1}</div>
                    <div className="lnd-step-title">{title}</div>
                    <div className="lnd-step-desc">{desc}</div>
                  </div>
                ))}
              </div>
              <button className="btn-connect-lg" onClick={handleConnect}>Connect Freighter</button>
            </div>
          ) : loading ? (
            <div className="loading-state"><div className="ls-urn">⚰</div><p>Loading wills…</p></div>
          ) : ownerIds.length === 0 ? (
            <div className="empty-state">
              <div className="es-urn">⚰</div>
              <p>No wills created yet.</p>
              <button className="btn-first" onClick={() => setTab('create')}>Create Your First Will</button>
            </div>
          ) : (
            <div className="wills-grid">
              {ownerIds.map(id => (
                <WillCard key={id} willId={id} wallet={wallet}
                  currentLedger={currentLedger} isBeneficiary={false} onAction={handleAction} />
              ))}
            </div>
          )
        )}

        {/* ── Inherited (beneficiary view) ── */}
        {tab === 'inherit' && (
          !wallet ? (
            <div className="empty-state">
              <div className="es-urn">⚰</div>
              <p>Connect to see wills where you are a beneficiary.</p>
              <button className="btn-first" onClick={handleConnect}>Connect</button>
            </div>
          ) : benefIds.length === 0 ? (
            <div className="empty-state">
              <div className="es-urn">⚰</div>
              <p>No one has named you as a beneficiary yet.</p>
            </div>
          ) : (
            <div className="wills-grid">
              {benefIds.map(id => (
                <WillCard key={id} willId={id} wallet={wallet}
                  currentLedger={currentLedger} isBeneficiary={true} onAction={handleAction} />
              ))}
            </div>
          )
        )}

        {/* ── Create ── */}
        {tab === 'create' && (
          <div className="form-wrap">
            {!wallet ? (
              <div className="empty-state">
                <div className="es-urn">⚰</div>
                <p>Connect wallet to create a will.</p>
                <button className="btn-first" onClick={handleConnect}>Connect</button>
              </div>
            ) : <CreateWillForm wallet={wallet} onCreated={handleCreated} />}
          </div>
        )}

        {/* ── Lookup ── */}
        {tab === 'lookup' && (
          <div className="form-wrap">
            <form className="lookup-form" onSubmit={handleLookup}>
              <input type="number" min="1"
                value={lookupId} onChange={e => setLookupId(e.target.value)}
                placeholder="Will ID" className="lookup-input" required />
              <button type="submit" className="btn-lookup">Look Up</button>
            </form>
            {lookupResult && (
              <WillCard willId={Number(lookupResult.id)} wallet={wallet}
                currentLedger={currentLedger} isBeneficiary={false} onAction={handleAction} />
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <span>ChainWill · Stellar Testnet · Soroban · Project #30 of 30</span>
        <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`} target="_blank" rel="noreferrer">Contract ↗</a>
      </footer>
    </div>
  )
}

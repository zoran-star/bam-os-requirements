import { useState } from 'react'
import { supabase } from './supabase'

// Default the picker to 24h ago, formatted for <input type="datetime-local">.
function defaultSince() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SlackDigest({ title = 'Slack Digest', onClose }) {
  const [since, setSince] = useState(defaultSince)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function run() {
    setLoading(true)
    setError('')
    setResult(null)
    const unix = Math.floor(new Date(since).getTime() / 1000)
    const { data, error } = await supabase.functions.invoke('slack-digest', { body: { since: unix } })
    setLoading(false)
    if (error) {
      setError(error.message || 'Something went wrong.')
      return
    }
    if (data?.error) {
      setError(data.error)
      return
    }
    setResult(data)
  }

  return (
    <div className="board">
      <header className="board-head">
        <button className="back" onClick={onClose} aria-label="back">‹</button>
        <h1 className="board-title">{title}</h1>
      </header>
      <p className="slide-hint">summarize every Slack channel & DM since…</p>

      <div className="sd-controls">
        <input
          type="datetime-local"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="sd-input"
        />
        <button className="sd-go" onClick={run} disabled={loading}>
          {loading ? 'summarizing…' : 'Summarize'}
        </button>
      </div>

      {loading && <div className="loading">reading Slack & summarizing… (can take ~30s)</div>}
      {error && <div className="sd-error">⚠️ {error}</div>}

      {result && (
        <div className="sd-result">
          {result.overview && (
            <div className="sd-overview">
              <h2>Overview</h2>
              <p>{result.overview}</p>
              <span className="sd-meta">{result.scanned || 0} conversations{result.capped ? ' (capped)' : ''}</span>
            </div>
          )}
          {(result.channels || []).map((c, i) => (
            <div key={i} className="sd-card">
              <div className="sd-card-head">
                <span className="sd-label">{c.label}</span>
                <span className="sd-count">{c.msgCount} msgs</span>
              </div>
              <p className="sd-summary">{c.summary}</p>
              {c.action && <p className="sd-action">→ {c.action}</p>}
            </div>
          ))}
          {(!result.channels || result.channels.length === 0) && !result.overview && (
            <div className="loading">Nothing to summarize in that window.</div>
          )}
        </div>
      )}
    </div>
  )
}

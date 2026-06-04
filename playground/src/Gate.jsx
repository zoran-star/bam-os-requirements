import { useState } from 'react'

// Lightweight passcode screen. This is a client-side gate to keep randoms out —
// not real auth. Set the code via VITE_PASSCODE (default below).
const PASSCODE = import.meta.env.VITE_PASSCODE || '0603'
const STORAGE_KEY = 'pg_unlocked'

export function isUnlocked() {
  return localStorage.getItem(STORAGE_KEY) === PASSCODE
}

export default function Gate({ onUnlock }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  function submit(e) {
    e.preventDefault()
    if (value === PASSCODE) {
      localStorage.setItem(STORAGE_KEY, value)
      onUnlock()
    } else {
      setError(true)
      setValue('')
    }
  }

  return (
    <div className="gate">
      <form className="gate-box" onSubmit={submit}>
        <h1>Playground</h1>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          placeholder="passcode"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(false)
          }}
          className={error ? 'shake' : ''}
        />
        {error && <p className="gate-err">nope, try again</p>}
        <button type="submit">enter</button>
      </form>
    </div>
  )
}

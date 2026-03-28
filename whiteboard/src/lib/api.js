const BASE = '/api'

export async function fetchSessions() {
  const res = await fetch(`${BASE}/sessions`)
  if (!res.ok) throw new Error('Failed to fetch sessions')
  return res.json()
}

export async function fetchSession(sessionId) {
  const res = await fetch(`${BASE}/sessions/${sessionId}`)
  if (!res.ok) throw new Error('Failed to fetch session')
  return res.json()
}

export async function fetchBacklog() {
  const res = await fetch(`${BASE}/backlog`)
  if (!res.ok) throw new Error('Failed to fetch backlog')
  return res.json()
}

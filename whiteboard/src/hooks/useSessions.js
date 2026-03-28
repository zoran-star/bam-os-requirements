import { useState, useEffect } from 'react'
import { fetchSessions } from '../lib/api'

export default function useSessions() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  const refresh = () => {
    setLoading(true)
    fetchSessions()
      .then(setSessions)
      .catch(setError)
      .finally(() => setLoading(false))
  }

  return { sessions, loading, error, refresh }
}

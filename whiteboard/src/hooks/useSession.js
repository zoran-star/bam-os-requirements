import { useState, useEffect } from 'react'
import { fetchSession } from '../lib/api'

export default function useSession(sessionId) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    fetchSession(sessionId)
      .then(setSession)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [sessionId])

  return { session, loading, error }
}

import { useState, useEffect } from 'react'
import { fetchBacklog } from '../lib/api'

export default function useBacklog() {
  const [backlog, setBacklog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchBacklog()
      .then(setBacklog)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  return { backlog, loading, error }
}

import { useEffect, useState } from 'react'
import s from '../styles/Header.module.css'

export default function Header({ sessions = [], onBacklogClick }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('bamos_theme') || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('bamos_theme', theme)
  }, [theme])

  const todo = sessions.filter(s => s.status === 'To Do').length
  const inProgress = sessions.filter(s => s.status === 'In Progress').length
  const complete = sessions.filter(s => s.status === 'Complete').length

  return (
    <header className={s.header}>
      <div className={s.left}>
        <div>
          <div className={s.title}>BAM <span className={s.gold}>OS</span> Onboarding</div>
          <div className={s.subtitle}>Session Whiteboard</div>
        </div>
      </div>
      <div className={s.right}>
        <span className={s.counts}>{todo} not ready / {inProgress} ready / {complete} done</span>
        <button className={`${s.btn} ${s.btnOutline}`} onClick={onBacklogClick}>Backlog</button>
        <button className={`${s.btn} ${s.btnTheme}`} onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '\u2600' : '\u263E'}
        </button>
      </div>
    </header>
  )
}

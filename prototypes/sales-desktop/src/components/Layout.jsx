import { useState } from 'react';
import Sidebar from './Sidebar';
import GlobalInbox from './GlobalInbox';
import SageBar from './SageBar';
import ErrorBoundary from './ErrorBoundary';
import s from '../styles/Layout.module.css';

export default function Layout({ children }) {
  const [inboxOpen, setInboxOpen] = useState(false);

  return (
    <div className={s.layout}>
      <Sidebar onInboxToggle={() => setInboxOpen(p => !p)} />
      <div className={s.pageContent}>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <SageBar />
      </div>
      <GlobalInbox isOpen={inboxOpen} onToggle={() => setInboxOpen(false)} />
    </div>
  );
}

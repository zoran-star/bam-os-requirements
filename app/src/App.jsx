import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useCallback } from 'react';
import { LocationProvider } from './context/LocationContext';
import Layout from './components/Layout';
import Sales from './pages/Sales';
import Home from './pages/Home';
import Marketing from './pages/Marketing';
import Members from './pages/Members';
import Schedule from './pages/Schedule';
import Content from './pages/Content';
import Settings from './pages/Settings';
import MemberApp from './pages/member-app/MemberApp';

// Notify parent window (survey) of route changes
function RouteNotifier() {
  const location = useLocation();
  useEffect(() => {
    const page = location.pathname.replace('/', '');
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'fc-route-change', page }, '*');
    }
  }, [location]);
  return null;
}

// Track clicks inside the prototype and send to parent (survey)
function ClickTracker() {
  const location = useLocation();
  const handleClick = useCallback((e) => {
    if (window.parent === window) return;
    const x = Math.round((e.clientX / window.innerWidth) * 10000) / 100;
    const y = Math.round((e.clientY / window.innerHeight) * 10000) / 100;
    const page = location.pathname.replace('/', '');
    window.parent.postMessage({
      type: 'fc-click',
      x,
      y,
      target: e.target?.tagName || '',
      page,
      timestamp: Date.now(),
    }, '*');
  }, [location]);

  useEffect(() => {
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [handleClick]);

  return null;
}

export default function App() {
  // Apply saved theme on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('fc_theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch {}
  }, []);

  return (
    <LocationProvider>
    <HashRouter>
      <RouteNotifier />
      <ClickTracker />
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Layout><Home /></Layout>} />
        <Route path="/schedule" element={<Layout><Schedule /></Layout>} />
        <Route path="/sales" element={<Layout><Sales /></Layout>} />
        <Route path="/marketing" element={<Layout><Marketing /></Layout>} />
        <Route path="/content" element={<Layout><Content /></Layout>} />
        <Route path="/members" element={<Layout><Members /></Layout>} />
        <Route path="/settings" element={<Layout><Settings /></Layout>} />
        <Route path="/member-app" element={<MemberApp />} />
      </Routes>
    </HashRouter>
    </LocationProvider>
  );
}

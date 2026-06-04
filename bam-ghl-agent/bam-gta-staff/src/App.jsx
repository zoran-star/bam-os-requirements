import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Home from './pages/Home';
import Pipeline from './pages/Pipeline';
import Analysis from './pages/Analysis';
import Sessions from './pages/Sessions';
import MemberProfiles from './pages/MemberProfiles';
import Admin from './pages/Admin';
import Inbox from './pages/Inbox';
import Trials from './pages/Trials';
import PostTrial from './pages/PostTrial';
import MemberActions from './pages/MemberActions';
import Automations from './pages/Automations';
import FailedPayments from './pages/FailedPayments';
import Onboarding from './pages/Onboarding';

export default function App() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bam_theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch {}
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Layout><Home /></Layout>} />
        <Route path="/pipeline" element={<Layout><Pipeline /></Layout>} />
        <Route path="/analysis" element={<Layout><Analysis /></Layout>} />
        <Route path="/sessions" element={<Layout><Sessions /></Layout>} />
        <Route path="/members" element={<Layout><MemberProfiles /></Layout>} />
        <Route path="/member-actions" element={<Layout><MemberActions /></Layout>} />
        <Route path="/admin" element={<Layout><Admin /></Layout>} />
        <Route path="/inbox" element={<Layout><Inbox /></Layout>} />
        <Route path="/trials" element={<Layout><Trials /></Layout>} />
        <Route path="/post-trial" element={<Layout><PostTrial /></Layout>} />
        <Route path="/automations" element={<Layout><Automations /></Layout>} />
        <Route path="/failed-payments" element={<Layout><FailedPayments /></Layout>} />
        <Route path="/onboarding" element={<Layout><Onboarding /></Layout>} />
      </Routes>
    </HashRouter>
  );
}

import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
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

export default function App() {
  return (
    <LocationProvider>
    <HashRouter>
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

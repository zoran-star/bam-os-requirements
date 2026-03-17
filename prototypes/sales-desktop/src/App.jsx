import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Sales from './pages/Sales';
import Home from './pages/Home';
import Marketing from './pages/Marketing';
import Members from './pages/Members';
import Settings from './pages/Settings';
import MemberApp from './pages/member-app/MemberApp';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Layout><Home /></Layout>} />
        <Route path="/sales" element={<Layout><Sales /></Layout>} />
        <Route path="/marketing" element={<Layout><Marketing /></Layout>} />
        <Route path="/members" element={<Layout><Members /></Layout>} />
        <Route path="/settings" element={<Layout><Settings /></Layout>} />
        <Route path="/member-app" element={<MemberApp />} />
      </Routes>
    </BrowserRouter>
  );
}

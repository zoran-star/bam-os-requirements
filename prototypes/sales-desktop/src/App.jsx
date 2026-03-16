import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sales from './pages/Sales';
import Home from './pages/Home';
import Marketing from './pages/Marketing';
import Members from './pages/Members';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/members" element={<Members />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

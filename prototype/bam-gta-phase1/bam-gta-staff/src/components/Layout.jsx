import Sidebar from './Sidebar';
import s from '../styles/Layout.module.css';

export default function Layout({ children }) {
  return (
    <div className={s.layout}>
      <Sidebar />
      <div className={s.pageContent}>
        {children}
      </div>
    </div>
  );
}

import Sidebar from './Sidebar';
import GlobalInbox from './GlobalInbox';
import SageFloat from './SageFloat';
import ErrorBoundary from './ErrorBoundary';
import s from '../styles/Layout.module.css';

export default function Layout({ children }) {
  return (
    <div className={s.layout}>
      <Sidebar />
      <div className={s.pageContent}>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </div>
      <GlobalInbox />
      <SageFloat />
    </div>
  );
}

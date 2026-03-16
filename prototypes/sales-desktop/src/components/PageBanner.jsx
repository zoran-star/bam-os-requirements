import { useRef } from 'react';
import useBannerCanvas from '../hooks/useBannerCanvas';
import StatPill from './StatPill';
import s from '../styles/shared.module.css';

export default function PageBanner({ title, stats = [], onDashboardClick }) {
  const canvasRef = useRef(null);
  useBannerCanvas(canvasRef);

  return (
    <div className={s.banner}>
      <div className={s.bannerCanvasWrap}>
        <canvas className={s.bannerCanvas} ref={canvasRef} />
      </div>
      <div className={s.bannerTop}>
        <h1 className={s.pageTitle}>{title}</h1>
        <div className={s.bannerStats}>
          {stats.map((stat, i) => (
            <StatPill key={i} value={stat.value} explanation={stat.explanation} />
          ))}
        </div>
      </div>
      <div className={s.bannerBottom}>
        <div />
        {onDashboardClick && (
          <button className={s.dashLink} onClick={onDashboardClick}>
            Full dashboard
            <svg width="13" height="13" fill="none" stroke="currentColor"
              strokeWidth="2" viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

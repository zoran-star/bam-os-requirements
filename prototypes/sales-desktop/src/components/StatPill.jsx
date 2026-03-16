import { useState } from 'react';
import s from '../styles/StatPill.module.css';

export default function StatPill({ value, explanation }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`${s.statPill} ${hovered ? s.statPillExpanded : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={s.statPillValue}
        style={{ opacity: hovered ? 0 : 1,
                 position: hovered ? 'absolute' : 'relative',
                 pointerEvents: 'none' }}>
        {value}
      </span>
      <span className={s.statPillExplain}
        style={{ opacity: hovered ? 1 : 0,
                 position: hovered ? 'relative' : 'absolute',
                 pointerEvents: 'none' }}>
        {explanation}
      </span>
    </div>
  );
}

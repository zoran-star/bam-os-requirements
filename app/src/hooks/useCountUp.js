import { useState, useEffect, useRef } from 'react';

export default function useCountUp(target, duration = 920) {
  const [value, setValue] = useState(0);
  const animRef = useRef(null);

  useEffect(() => {
    const start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(eased * target));
      if (p < 1) animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [target, duration]);

  return value;
}

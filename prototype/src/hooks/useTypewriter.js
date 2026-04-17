import { useState, useEffect, useRef } from 'react';

export default function useTypewriter(prompts) {
  const [text, setText] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    let pi = 0, ci = 0, deleting = false;
    function type() {
      const txt = prompts[pi];
      if (!deleting) {
        setText(txt.slice(0, ci + 1));
        ci++;
        if (ci >= txt.length) { timerRef.current = setTimeout(() => { deleting = true; type(); }, 2200); return; }
        timerRef.current = setTimeout(type, 55 + Math.random() * 40);
      } else {
        setText(txt.slice(0, ci));
        ci--;
        if (ci <= 0) { deleting = false; pi = (pi + 1) % prompts.length; timerRef.current = setTimeout(type, 400); return; }
        timerRef.current = setTimeout(type, 25);
      }
    }
    timerRef.current = setTimeout(type, 800);
    return () => clearTimeout(timerRef.current);
  }, [prompts]);

  return text;
}

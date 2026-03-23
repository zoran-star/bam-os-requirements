import { useEffect, useRef } from 'react';

export default function useBannerCanvas(canvasRef) {
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, t = 0;
    const barW = 10, barGap = 14, barBaseH = 0.55;
    let barCount = 28;

    function resize() {
      const r = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = w * r; canvas.height = h * r;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(r, 0, 0, r, 0, 0);
      // Recalculate bar count to fill the full width with padding
      const pad = 24;
      barCount = Math.max(10, Math.floor((w - pad * 2 + barGap) / (barW + barGap)));
    }
    function getBarX(i) {
      const pad = 24;
      const totalW = barCount * barW + (barCount - 1) * barGap;
      const startX = (w - totalW) / 2;
      return startX + i * (barW + barGap);
    }
    function getBarH(i) {
      const base = h * barBaseH, variance = h * 0.08;
      return base + Math.sin(i * 0.45 + t * 0.017) * variance + Math.sin(i * 0.8 + t * 0.011) * variance * 0.5;
    }
    function genCurvePts(seed, amp, yOff) {
      const pts = [], n = barCount - 1;
      for (let i = 0; i <= n; i++) {
        const x = getBarX(i) + barW / 2;
        const bh = getBarH(i);
        const y = (h - bh) + yOff + Math.sin(i * 0.6 + t * 0.014 + seed) * amp;
        pts.push({ x, y });
      }
      return pts;
    }
    function drawCurve(pts, color, lw) {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const cx = (pts[i].x + pts[i + 1].x) / 2;
        const cy = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, cx, cy);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    function draw() {
      const r = window.devicePixelRatio || 1;
      ctx.setTransform(r, 0, 0, r, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Dot grid
      const dotSpacing = 24;
      ctx.fillStyle = 'rgba(200,168,78,0.07)';
      for (let x = dotSpacing / 2; x < w; x += dotSpacing) {
        for (let y = dotSpacing / 2; y < h; y += dotSpacing) {
          ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Bars
      for (let i = 0; i < barCount; i++) {
        const x = getBarX(i), bh = getBarH(i), y = h - bh;
        const grad = ctx.createLinearGradient(x, y, x, h);
        grad.addColorStop(0, 'rgba(212,182,92,0.11)');
        grad.addColorStop(1, 'rgba(200,168,78,0.33)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(x, y, barW, bh, 3); ctx.fill();
      }
      // Curves
      const mainPts = genCurvePts(0, 6, -8);
      const shadowPts = genCurvePts(1.5, 5, -2);
      drawCurve(shadowPts, 'rgba(200,168,78,0.12)', 1);
      drawCurve(mainPts, 'rgba(200,168,78,0.42)', 2);
      // Glowing dots — spread evenly across bars
      const dotIndices = Array.from({ length: 5 }, (_, i) => Math.round((i + 1) * barCount / 6));
      ctx.save();
      for (const di of dotIndices) {
        if (di < mainPts.length) {
          const p = mainPts[di];
          ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(200,168,78,0.42)';
          ctx.fillStyle = 'rgba(200,168,78,0.54)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      t++;
      animRef.current = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    draw();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [canvasRef]);
}

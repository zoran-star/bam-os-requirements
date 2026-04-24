import { useState, useEffect } from "react";

// Breakpoints: mobile < 768, tablet 768-1024, desktop 1024+
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

export function useIsTablet() {
  const [isTablet, setIsTablet] = useState(window.innerWidth >= 768 && window.innerWidth < 1024);
  useEffect(() => {
    const handler = () => setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isTablet;
}

export function useBreakpoint() {
  const [bp, setBp] = useState(() => {
    const w = window.innerWidth;
    return w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop";
  });
  useEffect(() => {
    const handler = () => {
      const w = window.innerWidth;
      setBp(w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop");
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return bp;
}

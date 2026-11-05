"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Full-screen TV container that shrinks its text until everything fits on the screen,
 * so menu sections never overlap or get cut off (works for any TV size, landscape or portrait).
 */
export default function FitBoard({ base, className = "", children }: { base: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    let s = 1;
    el.style.fontSize = `calc(${base} * ${s})`;
    while (el.scrollHeight > el.clientHeight + 1 && s > 0.35) {
      s -= 0.02;
      el.style.fontSize = `calc(${base} * ${s.toFixed(2)})`;
    }
  }, [base]);
  useLayoutEffect(fit, [fit, children]);
  useEffect(() => {
    const again = () => requestAnimationFrame(fit);
    window.addEventListener("resize", again);
    window.addEventListener("load", again);
    document.fonts?.ready.then(again).catch(() => {});
    const imgs = ref.current?.querySelectorAll("img") ?? [];
    imgs.forEach((i) => i.addEventListener("load", again));
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("load", again);
      imgs.forEach((i) => i.removeEventListener("load", again));
    };
  }, [fit, children]);
  return <div ref={ref} className={`h-screen w-screen overflow-hidden ${className}`} style={{ fontSize: base }}>{children}</div>;
}

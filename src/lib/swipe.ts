import { useRef, type TouchEvent } from "react";

const EDGE = 24;

export function swipeDirection(dx: number, dy: number, ms: number): -1 | 1 | 0 {
  if (ms > 700 || Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

export function useSwipe(onSwipe: (dir: -1 | 1) => void, enabled = true) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  if (!enabled) return {};
  return {
    onTouchStart: (e: TouchEvent) => {
      const p = e.touches[0];
      const blocked = (e.target as HTMLElement).closest("[data-no-swipe],[role=dialog],[role=menu]");
      start.current =
        e.touches.length === 1 && !blocked && p.clientX > EDGE && p.clientX < window.innerWidth - EDGE
          ? { x: p.clientX, y: p.clientY, at: Date.now() }
          : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      const p = e.changedTouches[0];
      if (!s || !p) return;
      const dir = swipeDirection(p.clientX - s.x, p.clientY - s.y, Date.now() - s.at);
      if (dir) onSwipe(dir);
    },
    onTouchCancel: () => {
      start.current = null;
    },
  };
}

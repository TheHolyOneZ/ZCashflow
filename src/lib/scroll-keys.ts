export type ScrollJump = "top" | "bottom" | "up" | "down";

const SKIP = '[role="dialog"],[role="menu"],[role="listbox"],[role="radiogroup"],[role="tablist"],[role="slider"],[role="grid"],[contenteditable="true"]';

export function scrollJump(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): ScrollJump | null {
  if (e.altKey || e.shiftKey) return null;
  if (e.metaKey || e.ctrlKey) {
    if (e.key === "ArrowUp" || e.key === "Home") return "top";
    if (e.key === "ArrowDown" || e.key === "End") return "bottom";
    return null;
  }
  if (e.key === "Home") return "top";
  if (e.key === "End") return "bottom";
  if (e.key === "PageUp") return "up";
  if (e.key === "PageDown") return "down";
  return null;
}

export function jumpTarget(jump: ScrollJump, top: number, height: number, view: number): number {
  const max = Math.max(0, height - view);
  if (jump === "top") return 0;
  if (jump === "bottom") return max;
  const step = Math.round(view * 0.85);
  return Math.min(max, Math.max(0, top + (jump === "down" ? step : -step)));
}

export function scrollBlocked(target: EventTarget | null): boolean {
  if (document.querySelector('[role="dialog"],[role="menu"]')) return true;
  const el = target instanceof Element ? target : null;
  return !!el?.closest(SKIP);
}

export function calmMotion(): boolean {
  const mode = document.documentElement.dataset.motion;
  if (mode === "reduced") return true;
  if (mode === "full") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

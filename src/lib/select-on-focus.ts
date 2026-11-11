import type { FocusEvent, MouseEvent } from "react";

export const selectOnFocus = {
  onFocus(e: FocusEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    if (!el.value) return;
    el.dataset.selectAll = "1";
    requestAnimationFrame(() => el.select());
    window.setTimeout(() => delete el.dataset.selectAll, 400);
  },
  onMouseUp(e: MouseEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    if (el.dataset.selectAll !== "1") return;
    e.preventDefault();
    delete el.dataset.selectAll;
    el.select();
  },
};

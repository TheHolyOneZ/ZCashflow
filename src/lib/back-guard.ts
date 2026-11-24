const OVERLAY = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(",");

export function installBackGuard(): () => void {
  let guarded = false;
  let skip = 0;
  let frame = 0;

  const overlayOpen = () => document.querySelector(OVERLAY) !== null;

  const push = () => {
    history.pushState({ ...(history.state ?? {}), zcBack: true }, "");
    guarded = true;
  };

  const sync = () => {
    frame = 0;
    const open = overlayOpen();
    if (open && !guarded) {
      push();
    } else if (!open && guarded) {
      guarded = false;
      if (history.state?.zcBack) {
        skip++;
        history.back();
      }
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(sync);
  };

  const onPop = () => {
    if (skip > 0) {
      skip--;
      return;
    }
    if (guarded) {
      guarded = false;
      if (overlayOpen()) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      }
      schedule();
      return;
    }
    if (history.state?.zcBack) {
      skip++;
      history.back();
    }
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
  window.addEventListener("popstate", onPop);
  schedule();

  return () => {
    observer.disconnect();
    window.removeEventListener("popstate", onPop);
    if (frame) cancelAnimationFrame(frame);
  };
}

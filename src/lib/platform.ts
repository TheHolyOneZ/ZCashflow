const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

export const isMac = /Mac|iPhone|iPad/.test(ua);

export const isAndroid = /Android/.test(ua);

export const os: "mac" | "windows" | "linux" | "mobile" = /Android|iPhone|iPad/.test(ua)
  ? "mobile"
  : isMac
    ? "mac"
    : /Windows/.test(ua)
      ? "windows"
      : "linux";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const isDesktop = os !== "mobile";

export const modKey = isMac ? "⌘" : "Ctrl";

export function shortcutLabel(keys: string) {
  return keys
    .split("+")
    .map((k) => (k === "Mod" ? modKey : k === "Shift" ? (isMac ? "⇧" : "Shift") : k === "Alt" ? (isMac ? "⌥" : "Alt") : k))
    .join(isMac ? "" : "+");
}

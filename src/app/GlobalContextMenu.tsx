import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardPaste, Copy, Eye, EyeOff, Moon, Plus, ScanLine, Scissors, Search, Settings, Sun, TextSelect } from "lucide-react";
import { FloatingMenu, type FloatingItem } from "@/components/ui/context-menu";
import { shortcutLabel } from "@/lib/platform";
import { readClipboard, writeClipboard } from "@/lib/clipboard";
import { usePrefs } from "@/stores/prefs";
import { useUi } from "@/stores/ui";

type Field = HTMLInputElement | HTMLTextAreaElement;

function isTextField(el: Element | null): el is Field {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  return el instanceof HTMLInputElement && ["text", "search", "email", "url", "tel", "password", ""].includes(el.type) && !el.readOnly;
}

export function GlobalContextMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<{ at: { x: number; y: number }; field: Field | null; sel: [number, number] } | null>(null);
  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    let pending: { field: Field; sel: [number, number] } | null = null;
    function onDown(e: MouseEvent) {
      if (e.button !== 2) return;
      const target = (e.target as Element | null)?.closest("input, textarea") ?? null;
      if (!isTextField(target)) return;
      const focused = document.activeElement === target;
      pending = { field: target, sel: [target.selectionStart ?? 0, target.selectionEnd ?? 0] };
      if (focused) e.preventDefault();
      else {
        target.focus();
        const end = target.value.length;
        pending.sel = [end, end];
      }
    }
    function onMenu(e: MouseEvent) {
      if (e.defaultPrevented || (e.shiftKey && import.meta.env.DEV)) return;
      e.preventDefault();
      const target = (e.target as Element | null)?.closest("input, textarea") ?? null;
      const field = isTextField(target) ? target : null;
      const sel: [number, number] =
        field && pending?.field === field ? pending.sel : field ? [field.selectionStart ?? 0, field.selectionEnd ?? 0] : [0, 0];
      pending = null;
      setState({ at: { x: e.clientX, y: e.clientY }, field, sel });
    }
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("contextmenu", onMenu);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("contextmenu", onMenu);
    };
  }, []);

  if (!state) return null;
  const { field, sel } = state;
  const restore = () => {
    if (!field) return;
    field.focus();
    field.setSelectionRange(sel[0], sel[1]);
  };
  const selected = field ? field.value.slice(sel[0], sel[1]) : window.getSelection()?.toString() ?? "";

  let items: (FloatingItem | "separator")[];
  if (field) {
    items = [
      {
        label: t("menu.cut"),
        icon: Scissors,
        shortcut: shortcutLabel("Mod+X"),
        disabled: !selected,
        onSelect: async () => {
          restore();
          await writeClipboard(selected);
          document.execCommand("delete");
        },
      },
      { label: t("menu.copy"), icon: Copy, shortcut: shortcutLabel("Mod+C"), disabled: !selected, onSelect: () => writeClipboard(selected) },
      {
        label: t("menu.paste"),
        icon: ClipboardPaste,
        shortcut: shortcutLabel("Mod+V"),
        onSelect: async () => {
          const text = await readClipboard().catch(() => "");
          restore();
          if (text) document.execCommand("insertText", false, text);
        },
      },
      "separator",
      {
        label: t("menu.selectAll"),
        icon: TextSelect,
        shortcut: shortcutLabel("Mod+A"),
        onSelect: () => {
          field.focus();
          field.select();
        },
      },
    ];
  } else {
    const prefs = usePrefs.getState();
    const dark = document.documentElement.classList.contains("dark");
    items = [
      ...(selected ? [{ label: t("menu.copy"), icon: Copy, shortcut: shortcutLabel("Mod+C"), onSelect: () => writeClipboard(selected) }, "separator" as const] : []),
      { label: t("tx.new"), icon: Plus, shortcut: "N", onSelect: () => useUi.getState().openNewTx() },
      { label: t("receipts.scanTitle"), icon: ScanLine, onSelect: () => navigate({ to: "/receipts" }) },
      { label: t("shortcuts.palette"), icon: Search, shortcut: shortcutLabel("Mod+K"), onSelect: () => useUi.getState().setPaletteOpen(true) },
      "separator",
      {
        label: prefs.privacy ? t("shell.showAmounts") : t("shell.hideAmounts"),
        icon: prefs.privacy ? Eye : EyeOff,
        shortcut: shortcutLabel("Mod+Shift+H"),
        onSelect: () => prefs.toggle("privacy"),
      },
      { label: dark ? t("menu.lightMode") : t("menu.darkMode"), icon: dark ? Sun : Moon, onSelect: () => useUi.getState().setTheme(dark ? "light" : "dark") },
      { label: t("nav.settings"), icon: Settings, shortcut: shortcutLabel("Mod+,"), onSelect: () => navigate({ to: "/settings" }) },
    ];
  }
  return <FloatingMenu at={state.at} items={items} onClose={close} />;
}

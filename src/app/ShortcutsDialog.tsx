import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/ui/dialog";
import { isDesktop, isTauri, shortcutLabel } from "@/lib/platform";
import { navItems } from "./nav";

function Keys({ combo }: { combo: string }) {
  return (
    <span className="flex gap-1">
      {shortcutLabel(combo)
        .split(/(?<=[⌘⇧⌥])|\+/)
        .filter(Boolean)
        .map((k, i) => (
          <kbd
            key={i}
            className="min-w-6 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-center font-sans text-[11px] font-medium text-fg shadow-[0_1px_0_var(--border)]"
          >
            {k}
          </kbd>
        ))}
    </span>
  );
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: t("shortcuts.general"),
      items: [
        ["Mod+K", t("shortcuts.palette")],
        ["N", t("tx.new")],
        ["Mod+Shift+H", t("shortcuts.privacy")],
        ["Mod+B", t("shell.sidebar")],
        ["Mod+,", t("nav.settings")],
        ["?", t("shortcuts.title")],
        ...(isTauri && isDesktop ? [["F11", t("shortcuts.fullscreen")] as [string, string]] : []),
      ],
    },
    {
      title: t("shortcuts.navigate"),
      items: navItems.slice(0, 9).map((n, i) => [`Mod+${i + 1}`, t(n.labelKey)] as [string, string]),
    },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("shortcuts.title")} className="sm:max-w-2xl">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.title}</h3>
            <ul className="flex flex-col">
              {g.items.map(([combo, label]) => (
                <li key={combo} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-[13px] last:border-0">
                  <span>{label}</span>
                  <Keys combo={combo} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

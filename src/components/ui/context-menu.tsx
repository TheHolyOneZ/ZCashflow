import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { ContextMenu as CM } from "radix-ui";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type MenuEntry =
  | {
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      onSelect: () => void;
      danger?: boolean;
      confirm?: boolean;
      disabled?: boolean;
    }
  | "separator";

export const menuPanel =
  "z-[310] min-w-52 overflow-hidden rounded-xl border border-border bg-surface/95 p-1 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.35)] backdrop-blur-xl data-[state=open]:animate-[pop-in_120ms_var(--ease-out)]";

export const menuItem =
  "relative flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2";

function Entry({ entry }: { entry: Exclude<MenuEntry, "separator"> }) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  const Icon = entry.icon;
  return (
    <CM.Item
      disabled={entry.disabled}
      onSelect={(e) => {
        if (entry.confirm && !armed) {
          e.preventDefault();
          setArmed(true);
          return;
        }
        entry.onSelect();
      }}
      className={cn(menuItem, entry.danger && "text-expense data-[highlighted]:bg-expense/10", armed && "bg-expense/10 font-medium")}
    >
      {Icon && <Icon className={cn("size-4 shrink-0", entry.danger ? "text-expense" : "text-muted")} />}
      <span className="flex-1">{armed ? t("common.confirmDelete") : entry.label}</span>
      {entry.shortcut && <span className="text-[11px] text-muted">{entry.shortcut}</span>}
    </CM.Item>
  );
}

export function RowMenu({ items, children }: { items: MenuEntry[]; children: ReactElement }) {
  return (
    <CM.Root modal={false}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content collisionPadding={8} className={menuPanel}>
          {items.map((it, i) =>
            it === "separator" ? <CM.Separator key={i} className="my-1 h-px bg-border" /> : <Entry key={it.label} entry={it} />,
          )}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

export interface FloatingItem {
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
}

export function FloatingMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number } | null;
  items: (FloatingItem | "separator")[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(-1);
  const real = items.filter((i): i is FloatingItem => i !== "separator");

  useLayoutEffect(() => {
    if (!at || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(at.x, window.innerWidth - r.width - 8),
      y: at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height) : at.y,
    });
    setActive(-1);
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => {
          const n = real.length;
          let i = a;
          for (let k = 0; k < n; k++) {
            i = (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
            if (!real[i].disabled) break;
          }
          return i;
        });
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        real[active].onSelect();
        onClose();
      }
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [at, onClose, real, active]);

  if (!at) return null;
  let idx = -1;
  return (
    <div
      ref={ref}
      role="menu"
      data-state="open"
      onContextMenu={(e) => e.preventDefault()}
      className={cn(menuPanel, "fixed")}
      style={{ left: (pos ?? at).x, top: (pos ?? at).y, visibility: pos ? "visible" : "hidden" }}
    >
      {items.map((it, i) => {
        if (it === "separator") return <div key={i} className="my-1 h-px bg-border" />;
        idx++;
        const my = idx;
        const Icon = it.icon;
        return (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            data-highlighted={active === my ? "" : undefined}
            data-disabled={it.disabled ? "" : undefined}
            onMouseEnter={() => setActive(my)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              it.onSelect();
              onClose();
            }}
            className={cn(menuItem, "w-full text-left active:scale-100")}
          >
            {Icon && <Icon className="size-4 shrink-0 text-muted" />}
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="text-[11px] text-muted">{it.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { Select as S } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectItem {
  value: string;
  label: ReactNode;

  text?: string;
  icon?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  indent?: boolean;
}

const EMPTY = "__empty__";
const enc = (v: string) => (v === "" ? EMPTY : v);
const dec = (v: string) => (v === EMPTY ? "" : v);

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function itemsFromChildren(children: ReactNode): SelectItem[] {
  const out: SelectItem[] = [];
  const walk = (nodes: ReactNode) =>
    Children.forEach(nodes, (child) => {
      if (Array.isArray(child)) return walk(child);
      if (!isValidElement(child)) return;
      const el = child as ReactElement<{ value?: string; children?: ReactNode; disabled?: boolean }>;
      if (el.type === "option") {
        const text = textOf(el.props.children);
        const indent = text.startsWith(" ");
        out.push({
          value: el.props.value ?? text,
          label: indent ? text.slice(1) : el.props.children,
          text: text.trim(),
          disabled: el.props.disabled,
          indent,
        });
      } else {
        walk(el.props.children);
      }
    });
  walk(children);
  return out;
}

export interface SelectProps {
  id?: string;
  value: string;
  onChange?: (e: { target: { value: string } }) => void;
  onValueChange?: (value: string) => void;
  items?: SelectItem[];
  children?: ReactNode;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}

export function Select({
  id,
  value,
  onChange,
  onValueChange,
  items,
  children,
  className,
  triggerClassName,
  disabled,
  placeholder = "—",
  "aria-label": ariaLabel,
}: SelectProps) {
  const list = items ?? itemsFromChildren(children);
  const current = list.find((i) => i.value === value);
  const set = (v: string) => {
    if (v === "") return;
    onValueChange?.(dec(v));
    onChange?.({ target: { value: dec(v) } });
  };
  return (
    <S.Root value={enc(value)} onValueChange={set} disabled={disabled}>
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "group flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-left text-fg",
          "transition-[border-color,box-shadow] duration-150 hover:border-muted/40",
          "focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-accent data-[state=open]:ring-2 data-[state=open]:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50 active:scale-100",
          className,
          triggerClassName,
        )}
      >
        {current?.icon && <span className="shrink-0">{current.icon}</span>}
        <span className={cn("min-w-0 flex-1 truncate", !current && "text-muted/70")}>
          {current ? (current.text ?? current.label) : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            "z-[300] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden",
            "rounded-xl border border-border bg-surface p-1 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.25)]",
            "origin-[var(--radix-select-content-transform-origin)] data-[state=open]:animate-[pop-in_140ms_var(--ease-out)]",
          )}
        >
          <S.Viewport className="max-h-[inherit] overflow-y-auto">
            {list.map((item) => (
              <S.Item
                key={item.value}
                value={enc(item.value)}
                disabled={item.disabled}
                textValue={item.text ?? textOf(item.label)}
                className={cn(
                  "relative flex cursor-default items-center gap-2.5 rounded-lg py-2 pr-8 pl-2.5 text-[13px] outline-none select-none",
                  "data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40 data-[state=checked]:font-medium",
                  item.indent && "pl-7",
                )}
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <S.ItemText>{item.label}</S.ItemText>
                  {item.hint && <span className="block text-[11px] font-normal text-muted">{item.hint}</span>}
                </span>
                <S.ItemIndicator className="absolute right-2.5">
                  <Check className="size-3.5 text-accent" strokeWidth={2.5} />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

import { ChevronRight, CornerLeftUp, FolderPlus, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { RowMenu } from "@/components/ui/context-menu";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Card, CardHeader, PageHeader } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { ColorSwatches, ConfirmDeleteButton, FormFooter, Money } from "@/components/ui/extra";
import { CategoryIcon, IconPicker } from "@/components/category-icon";
import { api, planning, type Category, type CategoryKind } from "@/lib/api";
import { categoryTree, subtreeIds } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { monthRange } from "@/lib/dates";
import { displayName } from "@/lib/i18n";
import { useAppInfo, useAppMutation, useCategories, useSummary } from "@/lib/queries";

type Column = "expense" | "income";

interface DragState {
  id: string;
  x: number;
  y: number;
  over: string | null;
}

const fitsColumn = (c: Category, column: Column) => c.kind === column || c.kind === "both";

function useCategoryDrag(categories: Category[], onDrop: (c: Category, target: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback(
    (e: ReactPointerEvent, c: Category, column: Column) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const origin = { x: e.clientX, y: e.clientY };
      const blocked = subtreeIds(categories, c.id);
      const scroller = (e.currentTarget as HTMLElement).closest("main");
      let active = false;
      let target: string | null = null;
      const valid = (raw: string) => {
        if (raw.startsWith("root:")) return raw === `root:${column}` || (c.kind === "both" && raw.startsWith("root:"));
        if (blocked.has(raw)) return false;
        const t = categories.find((x) => x.id === raw);
        return !!t && (t.kind === "both" || c.kind === "both" || t.kind === c.kind);
      };
      const move = (ev: PointerEvent) => {
        if (!active && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 5) return;
        active = true;
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop]");
        const raw = el?.dataset.drop ?? null;
        target = raw && valid(raw) ? raw : null;
        setDrag({ id: c.id, x: ev.clientX, y: ev.clientY, over: target });
        if (scroller) {
          const r = scroller.getBoundingClientRect();
          if (ev.clientY < r.top + 56) scroller.scrollBy(0, -14);
          else if (ev.clientY > r.bottom - 56) scroller.scrollBy(0, 14);
        }
      };
      const stop = (drop: boolean) => {
        cleanup.current?.();
        setDrag(null);
        if (drop && active && target) onDrop(c, target);
      };
      const up = () => stop(true);
      const cancel = () => stop(false);
      const key = (ev: KeyboardEvent) => ev.key === "Escape" && cancel();
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key);
      cleanup.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key);
        cleanup.current = null;
      };
    },
    [categories, onDrop],
  );
  return { drag, start };
}

export function CategoriesPage() {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const currency = useAppInfo().data?.mainCurrency;
  const range = useMemo(() => monthRange(), []);
  const summary = useSummary(range.from, range.to, currency).data;
  const [edit, setEdit] = useState<{ category?: Category; kind?: CategoryKind; parentId?: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const move = useAppMutation(({ id, parentId }: { id: string; parentId: string | null }) => api.moveCategory(id, parentId), {
    success: t("categories.moved"),
  });

  const onDrop = useCallback(
    (c: Category, target: string) => {
      const parentId = target.startsWith("root:") ? null : target;
      if ((c.parentId ?? null) === parentId) return;
      if (parentId) setCollapsed((s) => (s.has(parentId) ? new Set([...s].filter((x) => x !== parentId)) : s));
      move.mutate({ id: c.id, parentId });
    },
    [move],
  );
  const { drag, start } = useCategoryDrag(categories, onDrop);
  const dragged = drag ? categories.find((c) => c.id === drag.id) : undefined;

  const spent = useMemo(() => {
    const own = new Map((summary?.expenseByCategory ?? []).map((r) => [r.categoryId, r.totalMinor]));
    const rolled = new Map<string, number>();
    for (const c of categories) {
      let sum = 0;
      for (const id of subtreeIds(categories, c.id)) sum += own.get(id) ?? 0;
      rolled.set(c.id, sum);
    }
    return rolled;
  }, [summary, categories]);

  const column = (kind: Column) => {
    const list = categories.filter((c) => fitsColumn(c, kind));
    const nodes = categoryTree(list);
    const hasChildren = new Set(list.map((c) => c.parentId).filter(Boolean) as string[]);
    let hiddenBelow: number | null = null;
    const visible = nodes.filter((n) => {
      if (hiddenBelow !== null && n.depth > hiddenBelow) return false;
      hiddenBelow = collapsed.has(n.category.id) ? n.depth : null;
      return true;
    });
    const rootDrop = `root:${kind}`;
    return (
      <Card className="overflow-hidden">
        <div data-drop={rootDrop} className={cn("transition-colors", drag?.over === rootDrop && "bg-accent-soft")}>
          <CardHeader
            title={kind === "expense" ? t("kind.expenses") : t("kind.incomes")}
            action={
              <Button size="sm" variant="ghost" onClick={() => setEdit({ kind })}>
                <Plus className="size-3.5" />
                {t("common.add")}
              </Button>
            }
          />
        </div>
        <ul className="pb-2">
          {visible.map(({ category: c, depth }) => (
            <li key={c.id}>
              <Row
                category={c}
                depth={depth}
                expandable={hasChildren.has(c.id)}
                expanded={!collapsed.has(c.id)}
                onToggle={() =>
                  setCollapsed((s) => {
                    const next = new Set(s);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })
                }
                spent={kind === "expense" ? spent.get(c.id) : undefined}
                currency={currency}
                dragging={drag?.id === c.id}
                dropTarget={drag?.over === c.id}
                onDragStart={(e) => start(e, c, kind)}
                onClick={() => setEdit({ category: c })}
                onAddChild={() => setEdit({ kind: c.kind, parentId: c.id })}
                onMoveToTop={c.parentId ? () => move.mutate({ id: c.id, parentId: null }) : undefined}
              />
            </li>
          ))}
        </ul>
        {drag && dragged && fitsColumn(dragged, kind) && (
          <div
            data-drop={rootDrop}
            className={cn(
              "mx-3 mb-3 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-3 py-3 text-[12px] text-muted transition-colors",
              drag.over === rootDrop && "border-accent bg-accent-soft text-accent",
            )}
          >
            <CornerLeftUp className="size-3.5" />
            {t("categories.dropTopLevel")}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className={cn("flex flex-col gap-3", drag && "cursor-grabbing select-none")}>
      <PageHeader title={t("nav.categories")} subtitle={t("categories.subtitle")} />
      <p className="-mt-2 flex items-center gap-1.5 text-[12px] text-muted">
        <GripVertical className="size-3.5 shrink-0" />
        {t("categories.dragHint")}
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {column("expense")}
        {column("income")}
      </div>
      {drag && dragged && (
        <div
          className="pointer-events-none fixed z-[90] flex items-center gap-2 rounded-xl border border-accent/50 bg-surface px-3 py-2 text-[13px] font-medium shadow-2xl"
          style={{ left: drag.x + 14, top: drag.y + 10 }}
        >
          <CategoryIcon category={dragged} className="size-6" />
          {displayName(dragged)}
        </div>
      )}
      <Dialog
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.category ? t("categories.edit") : t("categories.new")}
      >
        {edit && (
          <CategoryForm
            key={edit.category?.id ?? `new-${edit.kind}-${edit.parentId ?? ""}`}
            category={edit.category}
            kind={edit.kind ?? "expense"}
            parentId={edit.parentId}
            onDone={() => setEdit(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function Row({
  category,
  depth,
  expandable,
  expanded,
  onToggle,
  spent,
  currency,
  dragging,
  dropTarget,
  onDragStart,
  onClick,
  onAddChild,
  onMoveToTop,
}: {
  category: Category;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  spent?: number;
  currency?: string;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: (e: ReactPointerEvent) => void;
  onClick: () => void;
  onAddChild: () => void;
  onMoveToTop?: () => void;
}) {
  const { t } = useTranslation();
  const del = useAppMutation(planning.deleteCategory, { success: t("common.deleted") });
  return (
    <RowMenu
      items={[
        { label: t("common.edit"), icon: Pencil, onSelect: onClick },
        { label: t("categories.addSub"), icon: FolderPlus, onSelect: onAddChild },
        ...(onMoveToTop ? [{ label: t("categories.moveTop"), icon: CornerLeftUp, onSelect: onMoveToTop }] : []),
        "separator",
        { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => del.mutate(category.id) },
      ]}
    >
      <div
        data-drop={category.id}
        className={cn(
          "group flex items-center gap-1 pr-4 transition-colors hover:bg-surface-2",
          dragging && "opacity-40",
          dropTarget && "bg-accent-soft ring-2 ring-accent ring-inset",
        )}
        style={{ paddingLeft: `${0.25 + depth * 1.5}rem` }}
      >
        <span
          role="button"
          tabIndex={-1}
          aria-label={t("categories.dragHandle")}
          onPointerDown={onDragStart}
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted/50 hover:bg-surface hover:text-fg active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
        <button
          type="button"
          aria-label={expanded ? t("categories.collapse") : t("categories.expand")}
          aria-expanded={expanded}
          onClick={onToggle}
          className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:text-fg", !expandable && "invisible")}
        >
          <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
        </button>
        <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left active:scale-100">
          <CategoryIcon category={category} className={depth > 0 ? "size-7" : undefined} />
          <span className="min-w-0 flex-1 truncate font-medium">{displayName(category)}</span>
          {spent !== undefined && currency && <Money minor={spent} currency={currency} className="text-[13px] text-muted" />}
        </button>
      </div>
    </RowMenu>
  );
}

function CategoryForm({
  category,
  kind: initialKind,
  parentId: initialParent,
  onDone,
}: {
  category?: Category;
  kind: CategoryKind;
  parentId?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const [name, setName] = useState(category ? displayName(category) : "");
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? initialKind);
  const [parentId, setParentId] = useState(category?.parentId ?? initialParent ?? "");
  const parent = categories.find((c) => c.id === (category?.parentId ?? initialParent));
  const [color, setColor] = useState<string | null>(category?.color ?? parent?.color ?? "#0f766e");
  const [icon, setIcon] = useState<string | null>(category?.icon ?? "circle-dashed");
  const save = useAppMutation(api.upsertCategory, { success: t("common.saved") });
  const del = useAppMutation(planning.deleteCategory, { success: t("common.deleted") });
  const blocked = category ? subtreeIds(categories, category.id) : new Set<string>();
  const parents = categoryTree(categories.filter((c) => c.kind === kind || c.kind === "both" || kind === "both")).filter(
    (n) => !blocked.has(n.category.id),
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({
        id: category?.id,

        name: category && name === displayName(category) ? category.name : name,
        kind,
        parentId: parentId || null,
        color,
        icon,
      });
      onDone();
    } catch {
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Segmented<CategoryKind>
        aria-label={t("categories.kind")}
        value={kind}
        onChange={setKind}
        className="w-full"
        options={[
          { value: "expense", label: t("kind.expense") },
          { value: "income", label: t("kind.income") },
          { value: "both", label: t("categories.both") },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("accounts.name")} htmlFor="cat-name">
          <Input id="cat-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("categories.parent")} htmlFor="cat-parent" hint={t("common.optional")}>
          <Select
            id="cat-parent"
            value={parentId}
            onValueChange={setParentId}
            items={[
              { value: "", label: t("common.none") },
              ...parents.map((n) => ({
                value: n.category.id,
                label: displayName(n.category),
                depth: n.depth,
                icon: <CategoryIcon category={n.category} className="size-6 rounded-md [&_svg]:size-3.5" />,
              })),
            ]}
          />
        </Field>
      </div>
      <Field label={t("common.color")}>
        <ColorSwatches value={color} onChange={setColor} />
      </Field>
      <Field label={t("common.icon")}>
        <IconPicker value={icon} color={color} onChange={setIcon} />
      </Field>
      <FormFooter
        onCancel={onDone}
        saving={save.isPending}
        left={
          category && (
            <ConfirmDeleteButton
              onConfirm={async () => {
                try {
                  await del.mutateAsync(category.id);
                  onDone();
                } catch {
                }
              }}
            />
          )
        }
      />
    </form>
  );
}

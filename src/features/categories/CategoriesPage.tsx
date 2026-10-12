import { Pencil, Trash2, Plus } from "lucide-react";
import { RowMenu } from "@/components/ui/context-menu";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Card, CardHeader, PageHeader } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { ColorSwatches, ConfirmDeleteButton, FormFooter, Money } from "@/components/ui/extra";
import { CategoryIcon, IconPicker } from "@/components/category-icon";
import { api, planning, type Category, type CategoryKind } from "@/lib/api";
import { monthRange } from "@/lib/dates";
import { displayName } from "@/lib/i18n";
import { useAppInfo, useAppMutation, useCategories, useSummary } from "@/lib/queries";

export function CategoriesPage() {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const currency = useAppInfo().data?.defaultCurrency;
  const range = useMemo(() => monthRange(), []);
  const summary = useSummary(range.from, range.to, currency).data;
  const spent = new Map((summary?.expenseByCategory ?? []).map((r) => [r.categoryId, r.totalMinor]));
  const [edit, setEdit] = useState<{ category?: Category; kind?: CategoryKind } | null>(null);

  const column = (kind: "expense" | "income") => {
    const list = categories.filter((c) => c.kind === kind || c.kind === "both");
    const roots = list.filter((c) => !c.parentId || !list.some((p) => p.id === c.parentId));
    return (
      <Card className="overflow-hidden">
        <CardHeader
          title={kind === "expense" ? t("kind.expenses") : t("kind.incomes")}
          action={
            <Button size="sm" variant="ghost" onClick={() => setEdit({ kind })}>
              <Plus className="size-3.5" />
              {t("common.add")}
            </Button>
          }
        />
        <ul className="pb-2">
          {roots.map((c) => (
            <li key={c.id}>
              <Row category={c} spent={kind === "expense" ? spent.get(c.id) : undefined} currency={currency} onClick={() => setEdit({ category: c })} />
              {list
                .filter((s) => s.parentId === c.id)
                .map((s) => (
                  <Row
                    key={s.id}
                    category={s}
                    nested
                    spent={kind === "expense" ? spent.get(s.id) : undefined}
                    currency={currency}
                    onClick={() => setEdit({ category: s })}
                  />
                ))}
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("nav.categories")} subtitle={t("categories.subtitle")} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {column("expense")}
        {column("income")}
      </div>
      <Dialog
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.category ? t("categories.edit") : t("categories.new")}
      >
        {edit && (
          <CategoryForm
            key={edit.category?.id ?? `new-${edit.kind}`}
            category={edit.category}
            kind={edit.kind ?? "expense"}
            onDone={() => setEdit(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function Row({
  category,
  nested,
  spent,
  currency,
  onClick,
}: {
  category: Category;
  nested?: boolean;
  spent?: number;
  currency?: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const del = useAppMutation(planning.deleteCategory, { success: t("common.deleted") });
  return (
    <RowMenu
      items={[
        { label: t("common.edit"), icon: Pencil, onSelect: onClick },
        "separator",
        { label: t("common.delete"), icon: Trash2, danger: true, confirm: true, onSelect: () => del.mutate(category.id) },
      ]}
    >
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 py-2 pr-4 text-left hover:bg-surface-2 active:scale-100 ${nested ? "pl-12" : "pl-4"}`}
    >
      <CategoryIcon category={category} className={nested ? "size-7" : undefined} />
      <span className="min-w-0 flex-1 truncate font-medium">{displayName(category)}</span>
      {spent !== undefined && currency && <Money minor={spent} currency={currency} className="text-[13px] text-muted" />}
    </button>
    </RowMenu>
  );
}

function CategoryForm({ category, kind: initialKind, onDone }: { category?: Category; kind: CategoryKind; onDone: () => void }) {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const [name, setName] = useState(category ? displayName(category) : "");
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? initialKind);
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [color, setColor] = useState<string | null>(category?.color ?? "#0f766e");
  const [icon, setIcon] = useState<string | null>(category?.icon ?? "circle-dashed");
  const save = useAppMutation(api.upsertCategory, { success: t("common.saved") });
  const del = useAppMutation(planning.deleteCategory, { success: t("common.deleted") });
  const parents = categories.filter(
    (c) => !c.parentId && c.id !== category?.id && (c.kind === kind || c.kind === "both"),
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
          <Select id="cat-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t("common.none")}</option>
            {parents.map((c) => (
              <option key={c.id} value={c.id}>
                {displayName(c)}
              </option>
            ))}
          </Select>
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

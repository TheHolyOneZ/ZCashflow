import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/misc";

export function StatTile({
  label,
  hint,
  children,
  className,
  icon,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className={cn("px-4 py-3.5", className)}>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 min-h-8 truncate text-[19px] leading-8 font-semibold tracking-tight sm:text-[22px]">{children}</div>
      {hint && <div className="mt-0.5 truncate text-[12px] text-muted">{hint}</div>}
    </Card>
  );
}

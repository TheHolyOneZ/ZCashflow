export function idleLimit(lockAfter: string): number | null {
  if (lockAfter === "never" || lockAfter === "0") return null;
  const minutes = Number(lockAfter);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null;
}

export function shouldLock(lockAfter: string, hiddenFor: number): boolean {
  if (lockAfter === "never") return false;
  if (lockAfter === "0") return true;
  const limit = idleLimit(lockAfter);
  return limit !== null && hiddenFor >= limit;
}

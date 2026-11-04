export function normalizeTime(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  const m = /^(\d{1,2})(?:\s*[:.,h]?\s*(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const half = m[3]?.[0];
  if (half) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (half === "p" ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function splitTime(raw: string): { h: number; m: number } | null {
  const n = normalizeTime(raw);
  if (!n) return null;
  const [h, m] = n.split(":").map(Number);
  return { h, m };
}

export function joinTime(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function shiftMinutes(raw: string, by: number): string {
  const t = splitTime(raw) ?? { h: 0, m: 0 };
  const total = (((t.h * 60 + t.m + by) % 1440) + 1440) % 1440;
  return joinTime(Math.floor(total / 60), total % 60);
}

export function to12(h: number): { hour: number; pm: boolean } {
  return { hour: h % 12 || 12, pm: h >= 12 };
}

export function from12(hour: number, pm: boolean): number {
  return (hour % 12) + (pm ? 12 : 0);
}

export function showTime(raw: string, twelve: boolean): string {
  if (!twelve || !/^\d{2}:\d{2}$/.test(raw)) return raw;
  const t = splitTime(raw);
  if (!t) return raw;
  const { hour, pm } = to12(t.h);
  return `${hour}:${String(t.m).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
}

const KEY = "zc.lastAccount";

export function readLastAccount(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeLastAccount(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    return;
  }
}

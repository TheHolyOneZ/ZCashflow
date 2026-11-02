import { describe, expect, it } from "vitest";
import { idleLimit, shouldLock } from "./autolock";

describe("auto-lock", () => {
  it("turns the setting into an idle limit", () => {
    expect(idleLimit("5")).toBe(300_000);
    expect(idleLimit("0")).toBeNull();
    expect(idleLimit("never")).toBeNull();
  });

  it("locks after the app was hidden long enough", () => {
    expect(shouldLock("0", 10)).toBe(true);
    expect(shouldLock("1", 30_000)).toBe(false);
    expect(shouldLock("1", 60_000)).toBe(true);
    expect(shouldLock("never", 10_000_000)).toBe(false);
  });
});

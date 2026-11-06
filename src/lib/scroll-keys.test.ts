import { describe, expect, it } from "vitest";
import { jumpTarget, scrollJump } from "./scroll-keys";

const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("scrollJump", () => {
  it("maps Ctrl/Cmd with arrows to the ends", () => {
    expect(scrollJump(key("ArrowDown", { ctrlKey: true }))).toBe("bottom");
    expect(scrollJump(key("ArrowUp", { metaKey: true }))).toBe("top");
    expect(scrollJump(key("End", { ctrlKey: true }))).toBe("bottom");
  });

  it("maps Home, End and the page keys", () => {
    expect(scrollJump(key("Home"))).toBe("top");
    expect(scrollJump(key("End"))).toBe("bottom");
    expect(scrollJump(key("PageDown"))).toBe("down");
    expect(scrollJump(key("PageUp"))).toBe("up");
  });

  it("leaves other keys alone", () => {
    expect(scrollJump(key("ArrowDown"))).toBeNull();
    expect(scrollJump(key("ArrowDown", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(scrollJump(key("Home", { altKey: true }))).toBeNull();
    expect(scrollJump(key("k", { ctrlKey: true }))).toBeNull();
  });
});

describe("jumpTarget", () => {
  it("clamps to the scrollable range", () => {
    expect(jumpTarget("bottom", 0, 3000, 800)).toBe(2200);
    expect(jumpTarget("top", 1500, 3000, 800)).toBe(0);
    expect(jumpTarget("down", 2000, 3000, 800)).toBe(2200);
    expect(jumpTarget("down", 0, 3000, 800)).toBe(680);
    expect(jumpTarget("up", 300, 3000, 800)).toBe(0);
    expect(jumpTarget("bottom", 0, 500, 800)).toBe(0);
  });
});

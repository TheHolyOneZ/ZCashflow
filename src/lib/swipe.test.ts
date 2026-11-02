import { describe, expect, it } from "vitest";
import { swipeDirection } from "./swipe";

describe("swipeDirection", () => {
  it("goes forward on a swipe to the left and back on a swipe to the right", () => {
    expect(swipeDirection(-120, 10, 250)).toBe(1);
    expect(swipeDirection(120, -15, 250)).toBe(-1);
  });

  it("ignores short, slow and mostly vertical moves", () => {
    expect(swipeDirection(-40, 0, 200)).toBe(0);
    expect(swipeDirection(-150, 0, 1200)).toBe(0);
    expect(swipeDirection(-100, 80, 200)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeTime } from "./time";

describe("normalizeTime", () => {
  it.each([
    ["14:30", "14:30"],
    ["9:05", "09:05"],
    ["930", "09:30"],
    ["1430", "14:30"],
    ["7.45", "07:45"],
    ["18,30", "18:30"],
    ["14h30", "14:30"],
    ["8", "08:00"],
    ["2:30 pm", "14:30"],
    ["12 am", "00:00"],
    ["", ""],
    ["  ", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeTime(input)).toBe(expected);
  });

  it.each(["24:00", "12:60", "abc", "13 pm", "1:2"])("rejects %j", (input) => {
    expect(normalizeTime(input)).toBeNull();
  });
});

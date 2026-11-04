import { describe, expect, it } from "vitest";
import { from12, normalizeTime, shiftMinutes, showTime, to12 } from "./time";

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

describe("12-hour helpers", () => {
  it.each([
    [0, 12, false],
    [9, 9, false],
    [12, 12, true],
    [23, 11, true],
  ])("%i <-> %i", (h, hour, pm) => {
    expect(to12(h)).toEqual({ hour, pm });
    expect(from12(hour, pm)).toBe(h);
  });

  it("shows finished times only", () => {
    expect(showTime("14:30", true)).toBe("2:30 PM");
    expect(showTime("00:05", true)).toBe("12:05 AM");
    expect(showTime("14:30", false)).toBe("14:30");
    expect(showTime("14:", true)).toBe("14:");
  });

  it("shifts across hours and midnight", () => {
    expect(shiftMinutes("14:59", 1)).toBe("15:00");
    expect(shiftMinutes("23:59", 1)).toBe("00:00");
    expect(shiftMinutes("00:00", -1)).toBe("23:59");
    expect(shiftMinutes("", 1)).toBe("00:01");
  });
});

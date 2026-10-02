import { describe, expect, it } from "vitest";
import {
  calendarRange,
  dateRangeLabel,
  datePresets,
  emptyDateRange,
  presetDateRange,
  rangeQuery,
  validateDateRange,
  validDateText,
} from "./history-date-range";

describe("history date range draft and committed filter", () => {
  it("accepts an explicitly cleared range", () => {
    expect(validateDateRange(emptyDateRange).valid).toBe(true);
    expect(rangeQuery(emptyDateRange)).toEqual({
      from: undefined,
      until: undefined,
    });
  });
  it.each([
    { from: "2026-10-01", until: "" },
    { from: "", until: "2026-10-01" },
  ])("does not apply an incomplete range %o", (r) => {
    expect(validateDateRange(r).valid).toBe(false);
    expect(() => rangeQuery(r)).toThrow();
  });
  it.each([
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-01",
    "2026-10-00",
    "26-10-02",
    "2026-1-2",
    "2026-10-02T00:00:00Z",
    "invalid",
  ])("rejects a nonexistent or incorrectly formatted day %s", (value) =>
    expect(validDateText(value)).toBeNull(),
  );
  it("accepts a valid leap day and trims pasted whitespace", () => {
    expect(validDateText(" 2024-02-29 ")).toBe("2024-02-29");
    expect(
      validateDateRange({ from: " 2026-10-02 ", until: "2026-10-02\n" }).value,
    ).toEqual({ from: "2026-10-02", until: "2026-10-02" });
  });
  it("rejects reversed manual input without sorting or mutating it", () => {
    const r = { from: "2026-10-03", until: "2026-10-01" };
    expect(validateDateRange(r).valid).toBe(false);
    expect(r.from).toBe("2026-10-03");
    expect(calendarRange(r)).toEqual(["2026-10-03", null]);
  });
  it("derives calendar selection from the same input text, not another state", () => {
    expect(calendarRange({ from: "bad", until: "2026-10-02" })).toEqual([
      null,
      "2026-10-02",
    ]);
    expect(calendarRange({ from: "2026-10-01", until: "2026-10-02" })).toEqual([
      "2026-10-01",
      "2026-10-02",
    ]);
  });
  it("uses an exclusive following midnight and includes all of the selected end day", () => {
    const r = rangeQuery({ from: "2026-10-02", until: "2026-10-02" });
    expect(new Date(r.from).getHours()).toBe(0);
    expect(new Date(r.until).getDate()).toBe(3);
    for (const time of [
      new Date(2026, 9, 2, 0),
      new Date(2026, 9, 2, 23, 59, 59, 999),
    ])
      expect(time >= new Date(r.from) && time < new Date(r.until)).toBe(true);
    expect(new Date(2026, 9, 3, 0) < new Date(r.until)).toBe(false);
  });
  it.each(["2026-03-08", "2026-11-01"])(
    "uses calendar boundaries rather than adding 24 hours: %s",
    (day) => {
      const result = rangeQuery({ from: day, until: day }),
        start = new Date(result.from),
        end = new Date(result.until);
      expect(end.getHours()).toBe(0);
      expect(end.getDate()).toBe(start.getDate() + 1);
      expect(end.getTime() - start.getTime()).toBe(
        86400_000 +
          (end.getTimezoneOffset() - start.getTimezoneOffset()) * 60000,
      );
    },
  );
  it.each([
    ["今天", { from: "2026-01-02", until: "2026-01-02" }],
    ["最近7天", { from: "2025-12-27", until: "2026-01-02" }],
    ["最近30天", { from: "2025-12-04", until: "2026-01-02" }],
    ["本月", { from: "2026-01-01", until: "2026-01-02" }],
    ["上个月", { from: "2025-12-01", until: "2025-12-31" }],
  ] as const)("computes %s with inclusive calendar days", (preset, expected) =>
    expect(presetDateRange(preset, new Date(2026, 0, 2, 12))).toEqual(expected),
  );
  it("handles leap-year last month correctly", () =>
    expect(presetDateRange("上个月", new Date(2024, 2, 12))).toEqual({
      from: "2024-02-01",
      until: "2024-02-29",
    }));
  it("presets never mutate their supplied clock or shared empty state", () => {
    const now = new Date(2026, 0, 2),
      time = now.getTime();
    for (const p of datePresets)
      expect(validateDateRange(presetDateRange(p, now)).valid).toBe(true);
    expect(now.getTime()).toBe(time);
    expect(emptyDateRange).toEqual({ from: "", until: "" });
  });
  it("labels empty, single-date and complete ranges without ambiguity", () => {
    expect(dateRangeLabel(emptyDateRange)).toBe("全部日期");
    expect(dateRangeLabel({ from: "2026-10-02", until: "2026-10-02" })).toBe(
      "2026-10-02",
    );
    expect(dateRangeLabel({ from: "2026-09-30", until: "2026-10-02" })).toBe(
      "2026-09-30 至 2026-10-02",
    );
  });
});

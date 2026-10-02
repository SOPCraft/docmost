import { describe, it, expect } from "vitest";
import { localDateBoundary, localDateKey } from "./history-types";
describe("history date boundaries", () => {
  it("leaves an empty filter unset", () =>
    expect(localDateBoundary("")).toBeUndefined());
  it("serializes the local start of a day rather than assuming UTC", () =>
    expect(localDateBoundary("2026-10-02")).toBe(
      new Date(2026, 9, 2).toISOString(),
    ));
  it("uses the next local midnight for an inclusive end date", () =>
    expect(localDateBoundary("2026-10-02", true)).toBe(
      new Date(2026, 9, 3).toISOString(),
    ));
  it("handles month and year rollover", () => {
    expect(localDateBoundary("2026-12-31", true)).toBe(
      new Date(2027, 0, 1).toISOString(),
    );
    expect(localDateBoundary("2024-02-29", true)).toBe(
      new Date(2024, 2, 1).toISOString(),
    );
  });
  it.each(["2026-02-31", "not-a-date", "2026-13-01", "2026-00-02"])(
    "rejects invalid calendar value %s",
    (value) => expect(() => localDateBoundary(value)).toThrow(),
  );
  it("groups timestamps with local year/month/day fields", () => {
    const value = new Date(2026, 9, 2, 0, 1);
    expect(localDateKey(value.toISOString())).toBe("2026-10-02");
  });
  it("handles daylight-saving transition with calendar arithmetic", () => {
    const start = new Date(localDateBoundary("2026-03-08"));
    const end = new Date(localDateBoundary("2026-03-08", true));
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(0);
    expect(end.getDate()).toBe(9);
  });
});

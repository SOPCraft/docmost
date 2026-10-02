import { describe, expect, it } from "vitest";
import { compactExcerpt, summaryPreview } from "./history-summary-preview";
import type { ChangeSummary } from "./history-types";
const summary = (details: string[]) =>
  ({
    label: "修改正文",
    details,
    added: 2,
    deleted: 1,
    limited: false,
    metadataChanged: false,
    structureChanged: true,
  }) as ChangeSummary;
describe("small deterministic change preview", () => {
  it("uses a generic action when a verified summary is unavailable", () =>
    expect(summaryPreview()).toMatchObject({
      label: "查看此版本",
      brief: "查看此版本",
      items: [],
    }));
  it("shows what changed rather than repeating the row date and author", () => {
    expect(
      summaryPreview(summary(["新增：「检查数字」", "删除：「旧要求」"])).items,
    ).toEqual(["新增：「检查数字」", "删除：「旧要求」"]);
  });
  it("bounds preview lines and keeps full detail available on click", () => {
    const result = summaryPreview(
      summary(["新增：「甲」", "删除：「乙」", "标题：「丙」", "新增：「丁」"]),
    );
    expect(result.items).toHaveLength(3);
    expect(result.more).toBe(true);
  });
  it("does not split emoji or other multi-code-unit characters", () =>
    expect(compactExcerpt("👍👍👍", 2)).toBe("👍👍…"));
  it("normalizes whitespace for readable snippets", () =>
    expect(compactExcerpt("  新增\n\t内容  ")).toBe("新增 内容"));
  it("preserves text without rewriting or inventing intent", () => {
    const s = summary(["正文文字未变，格式发生变化。"]);
    const before = JSON.stringify(s);
    expect(summaryPreview(s).brief).toBe(s.details[0]);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("keeps the bounded-summary warning", () =>
    expect(
      summaryPreview({ ...summary(["内容较长"]), limited: true }).limited,
    ).toBe(true));
  it("limits a very long line in both list and hover preview", () => {
    const r = summaryPreview(summary(["新增：" + "字".repeat(300)]));
    expect(Array.from(r.brief)).toHaveLength(43);
    expect(Array.from(r.items[0])).toHaveLength(97);
  });
});

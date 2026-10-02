import { describe, expect, it } from "vitest";
import { classifyChange, compactChangePreview } from "./history-change-preview";
import type { ChangeSummary } from "./history-types";
const summary = (
  details: string[],
  added: number | null = 2,
  deleted: number | null = 1,
) =>
  ({
    label: "修改正文",
    details,
    added,
    deleted,
    limited: false,
    metadataChanged: false,
    structureChanged: true,
  }) as ChangeSummary;

describe("short semantic hover previews", () => {
  it("marks actual addition and deletion with separate semantic types", () => {
    expect(classifyChange("新增：「检查字幕」")).toEqual({
      kind: "added",
      label: "新增",
      text: "检查字幕",
    });
    expect(classifyChange("删除：「旧要求」")).toEqual({
      kind: "deleted",
      label: "删除",
      text: "旧要求",
    });
  });
  it("does not misclassify a metadata description containing a deletion word", () =>
    expect(classifyChange("正文没有删除内容").kind).toBe("other"));
  it("keeps a title change distinct from a document content deletion", () =>
    expect(classifyChange("标题：「旧名」→「新名」").kind).toBe("title"));
  it("keeps both directions visible when earlier details contain many additions", () => {
    const r = compactChangePreview(
      summary(["新增：「甲」", "新增：「乙」", "新增：「丙」", "删除：「旧」"]),
    );
    expect(r.lines.map((l) => l.kind)).toEqual(["added", "deleted", "added"]);
    expect(r.more).toBe(true);
  });
  it("shows counts as backend-supplied characters rather than invented lines", () =>
    expect(compactChangePreview(summary([], 12, 5)).heading).toBe(
      "新增 12 字，删除 5 字",
    ));
  it("does not invent a missing excerpt from positive totals", () =>
    expect(compactChangePreview(summary([], 12, 0)).lines).toEqual([]));
  it("does not display null or zero as a fabricated change count", () =>
    expect(compactChangePreview(summary([], null, 0)).heading).toBe(
      "修改正文",
    ));
  it("handles a missing summary without claiming no changes", () =>
    expect(compactChangePreview()).toMatchObject({
      heading: "查看此版本",
      lines: [],
    }));
  it("caps a Chinese preview to 42 characters plus an ellipsis", () =>
    expect(
      Array.from(classifyChange("新增：「" + "字".repeat(100) + "」").text),
    ).toHaveLength(43));
  it("does not break unicode characters when shortening", () =>
    expect(classifyChange("新增：「👍👍👍」", 2).text).toBe("👍👍…"));
  it("preserves scope limits and does not mutate original summary data", () => {
    const s = { ...summary(["正文格式改变"], 0, 0), limited: true },
      saved = JSON.stringify(s);
    expect(compactChangePreview(s).limited).toBe(true);
    expect(JSON.stringify(s)).toBe(saved);
  });
  it("limits visible fragments to three", () =>
    expect(
      compactChangePreview(summary(["甲", "乙", "丙", "丁"])).lines,
    ).toHaveLength(3));
});

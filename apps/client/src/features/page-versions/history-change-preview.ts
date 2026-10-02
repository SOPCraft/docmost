import type { ChangeSummary } from "./history-types";
import { compactExcerpt } from "./history-summary-preview";
export type PreviewKind = "added" | "deleted" | "title" | "other";
export interface ChangePreviewLine {
  kind: PreviewKind;
  label: string;
  text: string;
}

export function classifyChange(detail: string, limit = 42): ChangePreviewLine {
  const match = /^(新增|删除|标题)：(.*)$/s.exec(detail);
  if (!match)
    return { kind: "other", label: "", text: compactExcerpt(detail, limit) };
  const kind =
    match[1] === "新增" ? "added" : match[1] === "删除" ? "deleted" : "title";
  const text = match[2].replace(/^「(.*)」$/s, "$1");
  return { kind, label: match[1], text: compactExcerpt(text, limit) };
}
/** Snippets come only from the backend summary; counts are characters, never invented lines. */
export function compactChangePreview(summary?: ChangeSummary) {
  const details = (summary?.details || []).filter(Boolean);
  const lines = details.map((detail) => classifyChange(detail));
  const added = lines.find((line) => line.kind === "added");
  const deleted = lines.find((line) => line.kind === "deleted");
  const chosen = [
    added,
    deleted,
    ...lines.filter((line) => line !== added && line !== deleted),
  ]
    .filter((line): line is ChangePreviewLine => !!line)
    .slice(0, 3);
  const counts: string[] = [];
  if (typeof summary?.added === "number" && summary.added > 0)
    counts.push(`新增 ${summary.added} 字`);
  if (typeof summary?.deleted === "number" && summary.deleted > 0)
    counts.push(`删除 ${summary.deleted} 字`);
  return {
    heading: counts.join("，") || summary?.label || "查看此版本",
    lines: chosen,
    limited: !!summary?.limited,
    more: details.length > chosen.length,
  };
}

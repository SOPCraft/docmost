import type { ChangeSummary } from "./history-types";
export function compactExcerpt(value: string, limit = 72): string {
  const text = Array.from(value.replace(/\s+/g, " ").trim());
  return text.slice(0, limit).join("") + (text.length > limit ? "…" : "");
}
/** Display only deterministic, already verified summary strings. Never infer intent. */
export function summaryPreview(summary?: ChangeSummary) {
  const label = summary?.label || "查看此版本";
  const details = (summary?.details || []).filter(Boolean);
  const substantive = details.filter((d) => /^(标题|新增|删除|正文)/.test(d));
  const items = (substantive.length ? substantive : details)
    .slice(0, 3)
    .map((d) => compactExcerpt(d, 96));
  return {
    label,
    brief: compactExcerpt(details[0] || label, 42),
    items,
    more: details.length > items.length,
    limited: !!summary?.limited,
  };
}

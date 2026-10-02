import { localDateBoundary, localDateKey } from "./history-types";
export interface HistoryDateRange {
  from: string;
  until: string;
}
export const emptyDateRange: HistoryDateRange = { from: "", until: "" };
export function validDateText(value: string): string | null {
  const trimmed = value.trim();
  try {
    return trimmed &&
      /^\d{4}-\d{2}-\d{2}$/.test(trimmed) &&
      localDateBoundary(trimmed)
      ? trimmed
      : null;
  } catch {
    return null;
  }
}
export function validateDateRange(range: HistoryDateRange) {
  const from = range.from.trim(),
    until = range.until.trim();
  if (!from && !until)
    return { valid: true, message: "", value: { from, until } };
  if (!from || !until)
    return {
      valid: false,
      message: "请填写完整的开始日期和结束日期",
      value: { from, until },
    };
  if (!validDateText(from) || !validDateText(until))
    return {
      valid: false,
      message: "请输入存在的日期，格式为年-月-日",
      value: { from, until },
    };
  if (from > until)
    return {
      valid: false,
      message: "开始日期不能晚于结束日期",
      value: { from, until },
    };
  return { valid: true, message: "", value: { from, until } };
}
export function rangeQuery(range: HistoryDateRange) {
  const checked = validateDateRange(range);
  if (!checked.valid) throw new Error(checked.message);
  return {
    from: localDateBoundary(checked.value.from),
    until: localDateBoundary(checked.value.until, true),
  };
}
export function calendarRange(
  range: HistoryDateRange,
): [string | null, string | null] {
  const from = validDateText(range.from),
    until = validDateText(range.until);
  return from && until && from > until ? [from, null] : [from, until];
}
export const datePresets = [
  "今天",
  "最近7天",
  "最近30天",
  "本月",
  "上个月",
] as const;
export type DatePreset = (typeof datePresets)[number];
export function presetDateRange(
  preset: DatePreset,
  now = new Date(),
): HistoryDateRange {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    start = new Date(end);
  if (preset === "最近7天") start.setDate(start.getDate() - 6);
  else if (preset === "最近30天") start.setDate(start.getDate() - 29);
  else if (preset === "本月") start.setDate(1);
  else if (preset === "上个月") {
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    end.setDate(0);
  }
  return {
    from: localDateKey(start.toISOString()),
    until: localDateKey(end.toISOString()),
  };
}
export function dateRangeLabel(range: HistoryDateRange) {
  return !range.from && !range.until
    ? "全部日期"
    : range.from === range.until
      ? range.from
      : `${range.from} 至 ${range.until}`;
}

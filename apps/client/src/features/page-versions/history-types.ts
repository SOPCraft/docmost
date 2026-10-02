export interface VersionActor {
  id: string;
  name: string;
}
export interface ChangeSummary {
  label: string;
  details: string[];
  added: number | null;
  deleted: number | null;
  limited: boolean;
  metadataChanged: boolean;
  structureChanged: boolean;
}
export interface VersionRow {
  id: string;
  revision: number;
  status: string;
  createdAt: string;
  actors: VersionActor[];
  lastErrorCode?: string;
  previousId?: string | null;
  previousRevision?: number | null;
  summary?: ChangeSummary;
}
export interface VersionList {
  enabled: boolean;
  items: VersionRow[];
  hasMore: boolean;
  total: number;
}
export interface VersionInfo {
  id: string;
  revision: number;
  title: string;
  content: any;
  actors: VersionActor[];
  createdAt: string;
  exclusions: string[];
  deletedAt: string | null;
}
export interface VersionComparison {
  current: VersionInfo;
  previous: VersionInfo | null;
  summary: ChangeSummary;
  baseline: { id: string; revision: number } | null;
}
export const statusLabels: Record<string, string> = {
  pending: "待同步",
  processing: "提交中",
  synced: "已入库",
  failed: "同步失败",
  blocked: "同步已阻断",
};
export function localDateKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export function localDateBoundary(
  value: string,
  nextDay = false,
): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("日期无效");
  const [, y, m, d] = match.map(Number),
    date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  )
    throw new Error("日期无效");
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

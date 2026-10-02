import { useMemo, useState } from "react";
import { Button, Stack, Text, Tooltip } from "@mantine/core";
import {
  localDateKey,
  timeLabel,
  VersionRow,
  statusLabels,
} from "./history-types";
import classes from "./history-workspace.module.css";

export function VersionTimeline({
  rows,
  selected,
  onSelect,
  hasMore,
  onMore,
  loading,
}: {
  rows: VersionRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  hasMore: boolean;
  onMore: () => void;
  loading: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => {
    const result = new Map<string, VersionRow[]>();
    for (const row of rows) {
      const key = localDateKey(row.createdAt);
      result.set(key, [...(result.get(key) || []), row]);
    }
    return Array.from(result);
  }, [rows]);
  return (
    <div
      className={classes.timeline}
      data-testid="history-timeline"
      aria-label="版本时间列表"
    >
      {groups.map(([date, versions]) => (
        <section className={classes.day} key={date}>
          <button
            className={classes.dayToggle}
            aria-expanded={!collapsed.has(date)}
            onClick={() =>
              setCollapsed((old) => {
                const next = new Set(old);
                if (next.has(date)) next.delete(date);
                else next.add(date);
                return next;
              })
            }
          >
            {collapsed.has(date) ? "▸" : "▾"} {date}{" "}
            <span style={{ fontWeight: 400 }}>
              · 已加载 {versions.length} 条
            </span>
          </button>
          {!collapsed.has(date) &&
            versions.map((row) => (
              <Tooltip
                key={row.id}
                position="left"
                multiline
                w={310}
                withArrow
                openDelay={250}
                events={{ hover: true, focus: true, touch: false }}
                label={
                  <Stack gap={4}>
                    <Text size="xs" fw={600}>
                      {localDateKey(row.createdAt)} {timeLabel(row.createdAt)} ·
                      第 {row.revision} 版
                    </Text>
                    <Text size="xs">
                      {row.actors.map((a) => a.name).join("、")}
                    </Text>
                    <Text size="xs">
                      {row.summary?.label || statusLabels[row.status]}
                    </Text>
                    {row.summary?.details.map((detail, i) => (
                      <Text size="xs" key={i}>
                        {detail}
                      </Text>
                    ))}
                  </Stack>
                }
              >
                <button
                  type="button"
                  className={classes.row}
                  data-version-id={row.id}
                  data-revision={row.revision}
                  aria-label={`第${row.revision}版 ${date} ${timeLabel(row.createdAt)} ${row.actors.map((a) => a.name).join("、")}`}
                  aria-pressed={row.id === selected}
                  disabled={row.status !== "synced"}
                  onClick={() => onSelect(row.id)}
                >
                  <div className={classes.rowTime}>
                    <time dateTime={row.createdAt}>
                      {timeLabel(row.createdAt)}
                    </time>
                    <span className={classes.rowRevision}>
                      第 {row.revision} 版
                    </span>
                  </div>
                  <div className={classes.rowActors}>
                    {row.actors.map((a) => a.name).join("、")}
                  </div>
                  <div className={classes.rowSummary}>
                    {row.status === "synced"
                      ? row.summary?.label || "查看此版本"
                      : statusLabels[row.status] || "状态未知"}
                  </div>
                </button>
              </Tooltip>
            ))}
        </section>
      ))}
      {hasMore && (
        <Button
          fullWidth
          variant="subtle"
          mt="md"
          onClick={onMore}
          loading={loading}
        >
          加载更早版本
        </Button>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Button, Group, Text, Tooltip, UnstyledButton } from "@mantine/core";
import {
  localDateKey,
  timeLabel,
  VersionRow,
  statusLabels,
} from "./history-types";
import { HistoryChangePreview } from "./history-change-snippet";
import { summaryPreview } from "./history-summary-preview";
import native from "@/features/page-history/components/css/history.module.css";
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
    const values = new Map<string, VersionRow[]>();
    for (const row of rows) {
      const date = localDateKey(row.createdAt);
      values.set(date, [...(values.get(date) || []), row]);
    }
    return Array.from(values);
  }, [rows]);
  return (
    <div
      className={classes.timeline}
      data-testid="history-timeline"
      aria-label="版本时间列表"
    >
      {groups.map(([date, versions]) => (
        <section key={date}>
          <UnstyledButton
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
            {collapsed.has(date) ? "▸" : "▾"} {date}
          </UnstyledButton>
          {!collapsed.has(date) &&
            versions.map((row) => {
              const preview = summaryPreview(row.summary);
              return (
                <Tooltip
                  key={row.id}
                  position="bottom-end"
                  floatingStrategy="fixed"
                  middlewares={{
                    flip: {
                      fallbackPlacements: ["top-end"],
                      fallbackAxisSideDirection: "none",
                    },
                    shift: { padding: 8, crossAxis: false },
                  }}
                  data-testid="history-hover-preview"
                  data-preview-revision={row.revision}
                  multiline
                  w="min(248px, calc(100vw - 40px))"
                  color="var(--mantine-color-body)"
                  classNames={{ tooltip: classes.summaryPopover }}
                  openDelay={400}
                  closeDelay={100}
                  events={{ hover: true, focus: true, touch: false }}
                  label={<HistoryChangePreview summary={row.summary} />}
                >
                  <UnstyledButton
                    className={[
                      native.history,
                      native.historyButton,
                      classes.row,
                      row.id === selected ? native.active : "",
                    ].join(" ")}
                    type="button"
                    data-version-id={row.id}
                    data-revision={row.revision}
                    aria-label={`第${row.revision}版 ${date} ${timeLabel(row.createdAt)} ${row.actors.map((a) => a.name).join("、")}`}
                    aria-pressed={row.id === selected}
                    disabled={row.status !== "synced"}
                    onClick={() => onSelect(row.id)}
                  >
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text size="sm">
                        <time dateTime={row.createdAt}>
                          {timeLabel(row.createdAt)}
                        </time>
                      </Text>
                      <Text size="xs" c="dimmed">
                        第 {row.revision} 版
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                      {row.actors.map((a) => a.name).join("、")}
                    </Text>
                    <Text size="xs" lineClamp={1} mt={4}>
                      {row.status === "synced"
                        ? preview.brief
                        : statusLabels[row.status] || "状态未知"}
                    </Text>
                  </UnstyledButton>
                </Tooltip>
              );
            })}
        </section>
      ))}
      {hasMore && (
        <Button
          fullWidth
          variant="subtle"
          color="gray"
          size="xs"
          mt="xs"
          onClick={onMore}
          loading={loading}
        >
          加载更早版本
        </Button>
      )}
    </div>
  );
}

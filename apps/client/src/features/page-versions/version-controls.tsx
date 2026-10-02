import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Collapse,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import type { VersionRow } from "./history-types";
import { localDateKey, timeLabel } from "./history-types";
import type { VersionDetailModel } from "./use-version-detail";
import { classifyChange } from "./history-change-preview";
import { ChangeSnippet } from "./history-change-snippet";
import classes from "./history-workspace.module.css";

export function VersionControls({
  row,
  olderRows,
  model,
  onCloseHistory,
}: {
  row: VersionRow;
  olderRows: VersionRow[];
  model: VersionDetailModel;
  onCloseHistory: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    highlight,
    setHighlight,
    base,
    setBase,
    baseLabel,
    counts,
    navigation,
    summary,
    pending,
    failed,
    diffFailed,
    diffTooLarge,
    current,
  } = model;
  const canNavigate =
    highlight &&
    !!counts?.total &&
    !pending &&
    !failed &&
    !diffFailed &&
    !diffTooLarge;
  return (
    <section
      className={classes.controls}
      aria-label="所选历史版本操作"
      data-testid="history-controls"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          onCloseHistory();
        }
      }}
    >
      <Stack gap={4}>
        <Text size="xs" fw={500} lineClamp={1} data-testid="history-baseline">
          第 {row.revision} 版 · {baseLabel}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          lineClamp={1}
          data-testid="history-version-meta"
          title={
            localDateKey(row.createdAt) +
            " " +
            timeLabel(row.createdAt) +
            " · " +
            row.actors.map((a) => a.name).join("、")
          }
        >
          {localDateKey(row.createdAt)} {timeLabel(row.createdAt)} ·{" "}
          {row.actors.map((a) => a.name).join("、")}
        </Text>
        <SegmentedControl
          className={classes.viewMode}
          size="xs"
          fullWidth
          aria-label="历史显示方式"
          value={highlight ? "changes" : "document"}
          onChange={(v) => setHighlight(v === "changes")}
          data={[
            { value: "changes", label: "本次改动" },
            { value: "document", label: "只看正文" },
          ]}
        />
        <Group
          justify="space-between"
          gap={6}
          wrap="nowrap"
          className={classes.selectedSummary}
        >
          <Text
            size="xs"
            c="dimmed"
            lineClamp={1}
            data-testid="history-change-label"
            style={{ flex: 1, minWidth: 0 }}
          >
            {summary?.label ||
              (pending ? "正在读取…" : failed ? "读取失败" : "")}
          </Text>
          <Button
            variant="subtle"
            color="gray"
            size="compact-xs"
            px={2}
            aria-label="比较与详情"
            data-testid="history-details-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            rightSection={
              expanded ? (
                <IconChevronUp size={12} />
              ) : (
                <IconChevronDown size={12} />
              )
            }
          >
            详情
          </Button>
        </Group>
      </Stack>
      <Collapse expanded={expanded}>
        <Stack gap="xs" mt={6}>
          {highlight && (
            <>
              <Select
                size="xs"
                label="对比基准"
                aria-label="对比基准"
                value={base || "previous"}
                onChange={(v) => setBase(v === "previous" ? null : v)}
                data={[
                  { value: "previous", label: "默认：同文档上一版" },
                  ...olderRows.map((v) => ({
                    value: v.id,
                    label: `第 ${v.revision} 版 · ${timeLabel(v.createdAt)}`,
                  })),
                ]}
              />
              <Group gap="xs">
                <Text size="xs" c="teal">
                  新增高亮
                </Text>
                <Text size="xs" c="red" td="line-through">
                  删除内容
                </Text>
              </Group>
              {canNavigate && (
                <Group gap="xs" justify="space-between">
                  <Text size="xs" c="dimmed" data-testid="history-diff-count">
                    {navigation.currentChangeIndex}/{counts.total} 处
                  </Text>
                  <Group gap={4}>
                    <Tooltip label="上一处改动">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        aria-label="上一处改动"
                        onClick={navigation.handlePrevChange}
                      >
                        <IconChevronUp size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="下一处改动">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        aria-label="下一处改动"
                        onClick={navigation.handleNextChange}
                      >
                        <IconChevronDown size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              )}
            </>
          )}
          {summary && (
            <ul
              className={classes.summaryDetails}
              data-testid="history-change-summary"
            >
              {summary.details.map((v, i) => (
                <li key={i}>
                  <ChangeSnippet line={classifyChange(v, 160)} />
                </li>
              ))}
            </ul>
          )}
          {(diffFailed || diffTooLarge) && highlight && (
            <Alert color="yellow" p="xs">
              {diffTooLarge
                ? "文档较大，已暂停逐处高亮；仍可查看历史正文。"
                : "差异高亮未能完成，不能视为没有修改；请查看摘要或只看正文。"}
            </Alert>
          )}
          {current?.deletedAt && (
            <Text size="xs" c="orange">
              这一版记录了移入回收站。
            </Text>
          )}
          <Text size="xs" c="dimmed">
            历史正文与表格可查看；复杂静态布局会简化。图片、附件、批注及动态引用尚未完整固定，不用当前资料替代。
          </Text>
        </Stack>
      </Collapse>
    </section>
  );
}

import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import {
  ActionIcon,
  Button,
  Alert,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { HistoryEditor } from "@/features/page-history/components/history-editor";
import {
  highlightChangesAtom,
  diffCountsAtom,
} from "@/features/page-history/atoms/history-atoms";
import { useDiffNavigation } from "@/features/page-history/hooks/use-diff-navigation";
import api from "@/lib/api-client";
import {
  VersionComparison,
  VersionInfo,
  VersionRow,
  localDateKey,
  timeLabel,
} from "./history-types";
import classes from "./history-workspace.module.css";
const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };

export function VersionDetail({
  pageId,
  userId,
  row,
  olderRows,
  onShowVersions,
}: {
  pageId: string;
  userId: string;
  row: VersionRow;
  olderRows: VersionRow[];
  onShowVersions?: () => void;
}) {
  const [highlight, setHighlight] = useAtom(highlightChangesAtom);
  const counts = useAtomValue(diffCountsAtom);
  const [base, setBase] = useState<string | null>(null);
  const [diffFailed, setDiffFailed] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const onDiffError = useCallback(
    (failed: boolean) => setDiffFailed(failed),
    [],
  );
  const navigation = useDiffNavigation(viewport);
  const comparison = useQuery({
    queryKey: ["history-comparison", userId, pageId, row.id, base],
    queryFn: async ({ signal }) =>
      (
        await api.post<VersionComparison>(
          "/pages/versions/compare",
          { pageId, versionId: row.id, baseVersionId: base || undefined },
          { signal },
        )
      ).data,
    enabled: highlight,
    refetchInterval: highlight ? 10000 : false,
    retry: false,
    gcTime: 0,
  });
  const plain = useQuery({
    queryKey: ["history-document", userId, pageId, row.id],
    queryFn: async ({ signal }) =>
      (
        await api.post<VersionInfo>(
          "/pages/versions/info",
          { pageId, versionId: row.id },
          { signal },
        )
      ).data,
    enabled: !highlight,
    refetchInterval: !highlight ? 10000 : false,
    retry: false,
    gcTime: 0,
  });
  const active = highlight ? comparison : plain;
  const current = highlight ? comparison.data?.current : plain.data;
  const summary = highlight ? comparison.data?.summary : row.summary;
  const previous = highlight ? comparison.data?.previous : undefined;
  const baseLabel =
    highlight && comparison.data
      ? comparison.data.baseline
        ? `与第 ${comparison.data.baseline.revision} 版比较`
        : "首次保存，与空白文档比较"
      : highlight
        ? "正在读取比较基准"
        : "只读查看此版本";
  const diffTooLarge =
    !!current &&
    JSON.stringify(current.content).length +
      JSON.stringify(previous?.content || {}).length >
      250000;
  return (
    <>
      <div className={classes.toolbar}>
        <Group justify="space-between" gap="sm" wrap="wrap">
          <div>
            <Text fw={500} size="sm" data-testid="history-baseline">
              第 {row.revision} 版 · {baseLabel}
            </Text>
            <Text size="xs" c="dimmed">
              {localDateKey(row.createdAt)} {timeLabel(row.createdAt)} ·{" "}
              {row.actors.map((a) => a.name).join("、")}
            </Text>
          </div>
          <Button
            className={classes.mobileVersions}
            color="gray"
            size="compact-xs"
            variant="subtle"
            onClick={onShowVersions}
          >
            选择版本
          </Button>
          <SegmentedControl
            size="xs"
            aria-label="历史显示方式"
            value={highlight ? "changes" : "document"}
            onChange={(value) => setHighlight(value === "changes")}
            data={[
              { value: "changes", label: "本次改动" },
              { value: "document", label: "只看正文" },
            ]}
          />
        </Group>
        {highlight && (
          <Group mt="sm" justify="space-between" gap="sm">
            <Select
              size="xs"
              aria-label="对比基准"
              w={200}
              value={base || "previous"}
              onChange={(value) => setBase(value === "previous" ? null : value)}
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
              {!!counts?.total &&
                !active.isError &&
                !active.isPending &&
                !diffFailed &&
                !diffTooLarge && (
                  <>
                    <Text size="xs" c="dimmed">
                      {navigation.currentChangeIndex}/{counts.total} 处
                    </Text>
                    <Tooltip label="上一处改动">
                      <ActionIcon
                        variant="subtle"
                        aria-label="上一处改动"
                        onClick={navigation.handlePrevChange}
                      >
                        <IconChevronUp size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="下一处改动">
                      <ActionIcon
                        variant="subtle"
                        aria-label="下一处改动"
                        onClick={navigation.handleNextChange}
                      >
                        <IconChevronDown size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </>
                )}
            </Group>
          </Group>
        )}
      </div>
      <div
        className={classes.viewport}
        ref={viewport}
        data-testid="history-content-scroll"
      >
        {active.isError ? (
          <Alert color="red">
            无法读取所选版本或比较基准，或访问权限已变更。没有替换成其他版本；可切换“只看正文”重试。
          </Alert>
        ) : active.isPending ? (
          <div className={classes.empty}>
            <Loader />
          </div>
        ) : (
          current && (
            <article className={classes.paper}>
              {summary && (
                <details
                  className={classes.summary}
                  data-testid="history-change-summary"
                  open={summary.metadataChanged}
                >
                  <summary>
                    {summary.label}{" "}
                    <span style={{ fontWeight: 400 }}>· 查看变更详情</span>
                  </summary>
                  <ul className={classes.summaryDetails}>
                    {summary.details.map((detail, index) => (
                      <li key={index}>{detail}</li>
                    ))}
                  </ul>
                </details>
              )}
              {(diffFailed || diffTooLarge) && highlight && (
                <Alert color="yellow" mb="md">
                  {diffTooLarge
                    ? "此文档较大，已暂停逐处高亮；仍显示完整历史正文。"
                    : "此版的正文差异高亮未能完成，不能视为没有修改；请查看摘要或切换正文。"}
                </Alert>
              )}
              {current.deletedAt && (
                <Alert color="yellow" mb="md">
                  这一版记录了移入回收站。
                </Alert>
              )}
              <div data-testid="version-snapshot" className="editor-container">
                <HistoryEditor
                  key={`${row.id}:${base || "previous"}:${highlight}`}
                  title={current.title || "未命名文档"}
                  content={current.content}
                  previousContent={
                    highlight && !diffTooLarge
                      ? previous?.content || emptyDoc
                      : undefined
                  }
                  onDiffError={onDiffError}
                />
              </div>
              <Text size="xs" c="dimmed" mt="xl">
                历史正文与表格可查看；复杂静态布局会简化。图片、附件、批注及动态引用尚未完整固定，不用当前资料替代。
              </Text>
            </article>
          )
        )}
      </div>
    </>
  );
}

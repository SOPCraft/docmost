import { Text } from "@mantine/core";
import type { ChangeSummary } from "./history-types";
import {
  compactChangePreview,
  type ChangePreviewLine,
} from "./history-change-preview";
import native from "@/features/page-history/components/css/history.module.css";
import classes from "./history-workspace.module.css";

export function ChangeSnippet({ line }: { line: ChangePreviewLine }) {
  const colored =
    line.kind === "added"
      ? native.changeAdded
      : line.kind === "deleted"
        ? native.changeDeleted
        : undefined;
  return (
    <div className={classes.changeSnippet} data-preview-kind={line.kind}>
      {line.label && (
        <span className={classes.changePrefix}>
          {line.kind === "added" ? "+ " : line.kind === "deleted" ? "− " : ""}
          {line.label}
        </span>
      )}
      <span className={colored} data-preview-text={line.kind}>
        {line.text}
      </span>
    </div>
  );
}
export function HistoryChangePreview({ summary }: { summary?: ChangeSummary }) {
  const preview = compactChangePreview(summary);
  return (
    <div className={classes.changePreview}>
      <Text size="xs" fw={500}>
        {preview.heading}
      </Text>
      {preview.lines.map((line, index) => (
        <ChangeSnippet key={index} line={line} />
      ))}
      {(preview.more || preview.limited) && (
        <Text size="xs" c="dimmed">
          点击查看完整版本
        </Text>
      )}
    </div>
  );
}

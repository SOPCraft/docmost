import { createPortal } from "react-dom";
import { Alert, Container, Loader } from "@mantine/core";
import { HistoryEditor } from "@/features/page-history/components/history-editor";
import editorClasses from "@/features/editor/styles/editor.module.css";
import type { VersionRow } from "./history-types";
import { useVersionDetail } from "./use-version-detail";
import { VersionControls } from "./version-controls";
import classes from "./history-workspace.module.css";
const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };

/** One reader, one comparison state. A portal places controls in the right aside. */
export function VersionDetail({
  pageId,
  userId,
  row,
  olderRows,
  controlsHost,
  fullPageWidth,
  onCloseHistory,
}: {
  pageId: string;
  userId: string;
  row: VersionRow;
  olderRows: VersionRow[];
  controlsHost: HTMLDivElement | null;
  fullPageWidth: boolean;
  onCloseHistory: () => void;
}) {
  const model = useVersionDetail(pageId, userId, row);
  const {
    highlight,
    base,
    current,
    previous,
    pending,
    failed,
    diffTooLarge,
    viewport,
    onDiffError,
  } = model;
  return (
    <>
      {controlsHost &&
        createPortal(
          <VersionControls
            row={row}
            olderRows={olderRows}
            model={model}
            onCloseHistory={onCloseHistory}
          />,
          controlsHost,
        )}
      <div
        className={classes.viewport}
        ref={viewport}
        data-testid="history-content-scroll"
      >
        {failed ? (
          <Alert color="red" m="md">
            无法读取所选版本或比较基准，或访问权限已变更。没有替换成其他版本；可在右侧切换“只看正文”重试。
          </Alert>
        ) : pending ? (
          <div className={classes.empty}>
            <Loader size="sm" aria-label="正在读取历史内容" />
          </div>
        ) : (
          current && (
            <Container
              fluid={fullPageWidth}
              size={fullPageWidth ? undefined : 900}
              className={[
                editorClasses.editor,
                classes.historicalDocument,
              ].join(" ")}
            >
              <article className={classes.paper}>
                <div
                  data-testid="version-snapshot"
                  data-version-id={current.id}
                  className="editor-container"
                >
                  <HistoryEditor
                    key={`${row.id}:${base || "previous"}:${highlight}`}
                    pageLayout
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
              </article>
            </Container>
          )
        )}
      </div>
    </>
  );
}

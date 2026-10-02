import { useAtomValue } from "jotai";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import {
  activeHistorySelection,
  historyDrawerSelectionAtom,
} from "./history-drawer-state";
import classes from "@/features/page/components/header/page-header.module.css";

/** Keep a fixed slot in the title rail, never insert a new toolbar item. */
export function HistoryPreviewStatus({ pageId }: { pageId: string }) {
  const userId = useAtomValue(currentUserAtom)?.user?.id || "";
  const state = useAtomValue(historyDrawerSelectionAtom);
  const aside = useAtomValue(asideStateAtom);
  const selected = activeHistorySelection(state, aside, pageId, userId);
  const label = selected?.row ? `历史预览 · 第${selected.row.revision}版` : "";
  return (
    <span
      className={classes.historyStatusSlot}
      data-testid="history-status-slot"
    >
      <span
        className={classes.historyStatus}
        data-active={!!label}
        data-testid="history-preview-status"
        role="status"
        aria-live="polite"
        title={label || undefined}
      >
        {label}
      </span>
    </span>
  );
}

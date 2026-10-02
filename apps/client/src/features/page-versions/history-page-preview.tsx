import { ReactNode, useLayoutEffect, useRef } from "react";
import { Provider, useAtomValue, useSetAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import {
  activeHistorySelection,
  historyDrawerSelectionAtom,
} from "./history-drawer-state";
import { VersionDetail } from "./version-detail";
import classes from "./history-workspace.module.css";

/** Never feed a historical snapshot to the live collaborative editor. Keep it mounted. */
export function HistoryPagePreview({
  pageId,
  children,
}: {
  pageId: string;
  children: ReactNode;
}) {
  const userId = useAtomValue(currentUserAtom)?.user?.id || "";
  const aside = useAtomValue(asideStateAtom);
  const stored = useAtomValue(historyDrawerSelectionAtom);
  const setStored = useSetAtom(historyDrawerSelectionAtom);
  const selected = activeHistorySelection(stored, aside, pageId, userId);
  const row = selected?.row;
  const showing = !!row;
  const scroll = useRef(0);
  const returnScrollTop = selected?.returnScrollTop;
  useLayoutEffect(() => {
    if (!showing) return;
    scroll.current = returnScrollTop ?? window.scrollY;
    const path = location.pathname;
    return () => {
      if (location.pathname === path)
        window.scrollTo({ top: scroll.current, behavior: "instant" });
    };
  }, [showing, returnScrollTop]);
  return (
    <>
      <div data-testid="live-document-host" hidden={showing} inert={showing}>
        {children}
      </div>
      {row && (
        <section
          className={classes.preview}
          aria-label="历史正文与差异"
          data-testid="history-preview"
        >
          <Provider key={`${pageId}:${userId}:${row.id}`}>
            <VersionDetail
              pageId={pageId}
              userId={userId}
              row={row}
              olderRows={selected.olderRows}
              onShowVersions={() =>
                setStored((s) => (s ? { ...s, mobileContent: false } : null))
              }
            />
          </Provider>
        </section>
      )}
    </>
  );
}

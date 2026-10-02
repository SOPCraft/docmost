import { ReactNode, useCallback, useLayoutEffect, useRef } from "react";
import { Provider, useAtomValue, useSetAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import {
  activeHistorySelection,
  historyDrawerSelectionAtom,
} from "./history-drawer-state";
import { VersionDetail } from "./version-detail";
import {
  historyControlsHostAtom,
  matchingControlsHost,
} from "./history-controls-host";
import classes from "./history-workspace.module.css";

/** Never feed a historical snapshot to the live collaborative editor. Keep it mounted. */
export function HistoryPagePreview({
  pageId,
  children,
}: {
  pageId: string;
  children: ReactNode;
}) {
  const user = useAtomValue(currentUserAtom)?.user;
  const userId = user?.id || "";
  const fullPageWidth = !!user?.settings?.preferences?.fullPageWidth;
  const aside = useAtomValue(asideStateAtom);
  const setAside = useSetAtom(asideStateAtom);
  const closeHistory = useCallback(() => {
    setAside((old) =>
      old.tab === "history" ? { ...old, isAsideOpen: false } : old,
    );
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[data-testid="history-trigger"]')
        ?.focus(),
    );
  }, [setAside]);
  const stored = useAtomValue(historyDrawerSelectionAtom);
  const host = useAtomValue(historyControlsHostAtom);
  const controlsHost = matchingControlsHost(host, pageId, userId);
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
              controlsHost={controlsHost}
              fullPageWidth={fullPageWidth}
              onCloseHistory={closeHistory}
            />
          </Provider>
        </section>
      )}
    </>
  );
}

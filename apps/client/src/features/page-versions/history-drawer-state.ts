import { atom } from "jotai";
import type { VersionRow } from "./history-types";

export interface HistoryDrawerSelection {
  pageId: string;
  userId: string;
  row: VersionRow | null;
  olderRows: VersionRow[];
  mobileContent: boolean;
  returnScrollTop?: number;
}
export const historyDrawerSelectionAtom = atom<HistoryDrawerSelection>(
  currentHistorySelection("", ""),
);

export function activeHistorySelection(
  state: HistoryDrawerSelection | null,
  aside: { tab: string; isAsideOpen: boolean },
  pageId: string,
  userId: string,
): HistoryDrawerSelection | null {
  if (
    !userId ||
    !pageId ||
    !aside.isAsideOpen ||
    aside.tab !== "history" ||
    state?.pageId !== pageId ||
    state.userId !== userId
  )
    return null;
  return state;
}
export function currentHistorySelection(
  pageId: string,
  userId: string,
): HistoryDrawerSelection {
  return { pageId, userId, row: null, olderRows: [], mobileContent: false };
}

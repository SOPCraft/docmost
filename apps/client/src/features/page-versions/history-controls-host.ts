import { atom } from "jotai";

export interface HistoryControlsHost {
  pageId: string;
  userId: string;
  element: HTMLDivElement | null;
}
const empty: HistoryControlsHost = { pageId: "", userId: "", element: null };
export const historyControlsHostAtom = atom<HistoryControlsHost>(empty);

/** Portals share the actual reader state; never mount a second data-fetching reader. */
export function matchingControlsHost(
  host: HistoryControlsHost,
  pageId: string,
  userId: string,
) {
  return pageId && userId && host.pageId === pageId && host.userId === userId
    ? host.element
    : null;
}

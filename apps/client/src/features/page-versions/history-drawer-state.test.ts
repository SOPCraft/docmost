import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  activeHistorySelection,
  currentHistorySelection,
  historyDrawerSelectionAtom,
} from "./history-drawer-state";
import type { VersionRow } from "./history-types";
const aside = { tab: "history", isAsideOpen: true };
const row = {
  id: "v2",
  revision: 2,
  status: "synced",
  actors: [],
  createdAt: "2026-10-02T00:00:00Z",
} as VersionRow;
const state = { ...currentHistorySelection("page-a", "user-a"), row };
describe("native history drawer view state", () => {
  it("opens on the current document, not an arbitrary historical snapshot", () => {
    expect(currentHistorySelection("page-a", "user-a")).toEqual({
      pageId: "page-a",
      userId: "user-a",
      row: null,
      olderRows: [],
      mobileContent: false,
    });
  });
  it("resolves history only for the matching document and logged-in user", () =>
    expect(activeHistorySelection(state, aside, "page-a", "user-a")).toBe(
      state,
    ));
  it.each(["comments", "toc", "details", "chat", ""])(
    "does not keep historical content when the native panel is %s",
    (tab) => {
      expect(
        activeHistorySelection(
          state,
          { tab, isAsideOpen: true },
          "page-a",
          "user-a",
        ),
      ).toBeNull();
    },
  );
  it("returns current document when the drawer closes", () =>
    expect(
      activeHistorySelection(
        state,
        { ...aside, isAsideOpen: false },
        "page-a",
        "user-a",
      ),
    ).toBeNull());
  it.each([
    ["page-b", "user-a"],
    ["page-a", "user-b"],
    ["", "user-a"],
    ["page-a", ""],
  ])("does not leak the previous selection into %s / %s", (page, user) => {
    expect(activeHistorySelection(state, aside, page, user)).toBeNull();
  });
  it("can return to current document without destroying the stored immutable row", () => {
    const store = createStore();
    store.set(historyDrawerSelectionAtom, state);
    store.set(
      historyDrawerSelectionAtom,
      currentHistorySelection("page-a", "user-a"),
    );
    expect(store.get(historyDrawerSelectionAtom).row).toBeNull();
    expect(state.row).toBe(row);
  });
  it("keeps narrow-screen display state separate from which version is selected", () => {
    const store = createStore();
    store.set(historyDrawerSelectionAtom, state);
    store.set(historyDrawerSelectionAtom, (old) => ({
      ...old,
      mobileContent: true,
    }));
    expect(store.get(historyDrawerSelectionAtom).row).toBe(row);
  });
});

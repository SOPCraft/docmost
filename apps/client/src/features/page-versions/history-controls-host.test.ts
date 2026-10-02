import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  historyControlsHostAtom,
  matchingControlsHost,
} from "./history-controls-host";

describe("single-reader right control target", () => {
  const element = {} as HTMLDivElement;
  const host = { pageId: "page-a", userId: "user-a", element };
  it("resolves only the actual current page and user target", () =>
    expect(matchingControlsHost(host, "page-a", "user-a")).toBe(element));
  it.each([
    ["page-b", "user-a"],
    ["page-a", "user-b"],
    ["", "user-a"],
    ["page-a", ""],
  ])("does not reuse another scope: %s %s", (page, user) =>
    expect(matchingControlsHost(host, page, user)).toBeNull(),
  );
  it("has no portal before the native sidebar registers its target", () => {
    const store = createStore();
    expect(
      matchingControlsHost(
        store.get(historyControlsHostAtom),
        "page-a",
        "user-a",
      ),
    ).toBeNull();
  });
  it("removes its target when the sidebar closes without retaining a DOM node", () => {
    const store = createStore();
    store.set(historyControlsHostAtom, host);
    store.set(historyControlsHostAtom, {
      pageId: "",
      userId: "",
      element: null,
    });
    expect(store.get(historyControlsHostAtom).element).toBeNull();
  });
});

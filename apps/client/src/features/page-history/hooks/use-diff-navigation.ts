import { useAtomValue } from "jotai";
import { RefObject, useCallback, useEffect, useState } from "react";
import { diffCountsAtom } from "@/features/page-history/atoms/history-atoms";

/**
 * Manages navigation between diff changes in the history view.
 * Provides prev/next handlers and auto-scrolls to the current change.
 */
export function useDiffNavigation(
  scrollViewportRef: RefObject<HTMLDivElement>,
  autoScroll = true,
) {
  const diffCounts = useAtomValue(diffCountsAtom);
  const [selection, setSelection] = useState<{
    counts: typeof diffCounts;
    index: number;
  }>({ counts: null, index: 0 });
  const currentChangeIndex = diffCounts?.total
    ? selection.counts === diffCounts
      ? Math.max(1, Math.min(selection.index, diffCounts.total))
      : 1
    : 0;

  const scrollToChangeIndex = useCallback(
    (index: number) => {
      const viewport = scrollViewportRef.current;
      if (!viewport || index < 1) return;

      const element = viewport.querySelector(`[data-diff-index="${index}"]`);
      if (element instanceof HTMLElement) {
        const elementTop =
          element.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop;
        const viewportHeight = viewport.clientHeight;
        const scrollTarget =
          elementTop - viewportHeight / 2 + element.offsetHeight / 2;
        viewport.scrollTo({ top: scrollTarget, behavior: "smooth" });
      }
    },
    [scrollViewportRef],
  );

  useEffect(() => {
    if (autoScroll && diffCounts && diffCounts.total > 0) {
      const frame = requestAnimationFrame(() => scrollToChangeIndex(1));
      return () => cancelAnimationFrame(frame);
    }
  }, [diffCounts, scrollToChangeIndex, autoScroll]);

  const handlePrevChange = useCallback(() => {
    if (!diffCounts || diffCounts.total === 0) return;
    const newIndex =
      currentChangeIndex <= 1 ? diffCounts.total : currentChangeIndex - 1;
    setSelection({ counts: diffCounts, index: newIndex });
    scrollToChangeIndex(newIndex);
  }, [diffCounts, currentChangeIndex, scrollToChangeIndex]);

  const handleNextChange = useCallback(() => {
    if (!diffCounts || diffCounts.total === 0) return;
    const newIndex =
      currentChangeIndex >= diffCounts.total ? 1 : currentChangeIndex + 1;
    setSelection({ counts: diffCounts, index: newIndex });
    scrollToChangeIndex(newIndex);
  }, [diffCounts, currentChangeIndex, scrollToChangeIndex]);

  return { currentChangeIndex, handlePrevChange, handleNextChange };
}

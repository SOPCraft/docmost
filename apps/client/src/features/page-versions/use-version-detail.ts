import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import {
  highlightChangesAtom,
  diffCountsAtom,
} from "@/features/page-history/atoms/history-atoms";
import { useDiffNavigation } from "@/features/page-history/hooks/use-diff-navigation";
import api from "@/lib/api-client";
import type {
  VersionRow,
  VersionComparison,
  VersionInfo,
} from "./history-types";

export function useVersionDetail(
  pageId: string,
  userId: string,
  row: VersionRow,
) {
  const [highlight, setHighlight] = useAtom(highlightChangesAtom);
  const counts = useAtomValue(diffCountsAtom);
  const [base, setBase] = useState<string | null>(null);
  const [diffFailed, setDiffFailed] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const onDiffError = useCallback(
    (failed: boolean) => setDiffFailed(failed),
    [],
  );
  const navigation = useDiffNavigation(viewport, false);
  const comparison = useQuery({
    queryKey: ["history-comparison", userId, pageId, row.id, base],
    queryFn: async ({ signal }) =>
      (
        await api.post<VersionComparison>(
          "/pages/versions/compare",
          { pageId, versionId: row.id, baseVersionId: base || undefined },
          { signal },
        )
      ).data,
    enabled: highlight,
    refetchInterval: highlight ? 10000 : false,
    retry: false,
    gcTime: 0,
  });
  const plain = useQuery({
    queryKey: ["history-document", userId, pageId, row.id],
    queryFn: async ({ signal }) =>
      (
        await api.post<VersionInfo>(
          "/pages/versions/info",
          { pageId, versionId: row.id },
          { signal },
        )
      ).data,
    enabled: !highlight,
    refetchInterval: !highlight ? 10000 : false,
    retry: false,
    gcTime: 0,
  });
  const active = highlight ? comparison : plain;
  const current = highlight ? comparison.data?.current : plain.data;
  const summary = highlight ? comparison.data?.summary : row.summary;
  const previous = highlight ? comparison.data?.previous : undefined;
  const baseLabel =
    highlight && comparison.data
      ? comparison.data.baseline
        ? `与第 ${comparison.data.baseline.revision} 版比较`
        : "首次保存，与空白文档比较"
      : highlight
        ? "正在读取比较基准"
        : "只读查看此版本";
  const diffTooLarge =
    !!current &&
    JSON.stringify(current.content).length +
      JSON.stringify(previous?.content || {}).length >
      250000;

  const mismatch =
    !!current &&
    (current.id !== row.id ||
      (highlight && base && comparison.data?.baseline?.id !== base));
  const failed = active.isError || mismatch || (!active.isPending && !current);
  return {
    highlight,
    setHighlight,
    counts,
    base,
    setBase,
    diffFailed,
    viewport,
    onDiffError,
    navigation,
    current: failed ? undefined : current,
    summary: failed ? undefined : summary,
    previous: failed ? undefined : previous,
    baseLabel,
    diffTooLarge,
    failed,
    pending: active.isPending,
  };
}
export type VersionDetailModel = ReturnType<typeof useVersionDetail>;

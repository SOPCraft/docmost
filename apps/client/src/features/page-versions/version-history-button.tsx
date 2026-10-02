import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import { useMediaQuery } from "@mantine/hooks";
import { ASIDE_PANEL_ID } from "@/hooks/use-toggle-aside";
import api from "@/lib/api-client";
import { VersionList } from "./history-types";
import {
  activeHistorySelection,
  currentHistorySelection,
  historyDrawerSelectionAtom,
} from "./history-drawer-state";

export default function VersionHistoryButton({ pageId }: { pageId: string }) {
  const userId = useAtomValue(currentUserAtom)?.user?.id;
  return userId ? (
    <VersionHistoryEntry
      key={`${userId}:${pageId}`}
      pageId={pageId}
      userId={userId}
    />
  ) : null;
}
function VersionHistoryEntry({
  pageId,
  userId,
}: {
  pageId: string;
  userId: string;
}) {
  const [aside, setAside] = useAtom(asideStateAtom);
  const stored = useAtomValue(historyDrawerSelectionAtom);
  const selected = activeHistorySelection(stored, aside, pageId, userId);
  const mobile = useMediaQuery("(max-width:47.99em)");
  const setSelection = useSetAtom(historyDrawerSelectionAtom);
  const opened = aside.isAsideOpen && aside.tab === "history";
  const status = useQuery({
    queryKey: ["sop-history-status", userId, pageId],
    queryFn: async ({ signal }) =>
      (
        await api.post<VersionList>(
          "/pages/versions/list",
          { pageId, summaries: false },
          { signal },
        )
      ).data,
    refetchInterval: (q) =>
      opened || q.state.data?.enabled === false ? false : 5000,
    retry: false,
    gcTime: 0,
  });
  if (!status.isError && !status.data?.enabled) return null;
  return (
    <>
      <Tooltip
        label={
          status.isError
            ? "历史记录暂不可用，点击重试"
            : mobile && selected?.row
              ? "选择版本"
              : "历史"
        }
        openDelay={250}
        withArrow
      >
        <ActionIcon
          variant="subtle"
          color="dark"
          aria-label="历史"
          aria-description={
            selected?.row
              ? `历史预览，第${selected.row.revision}版，点击选择版本`
              : undefined
          }
          aria-controls={ASIDE_PANEL_ID}
          aria-expanded={opened}
          data-testid="history-trigger"
          onClick={() => {
            if (mobile && opened && selected?.mobileContent) {
              setSelection((s) => ({ ...s, mobileContent: false }));
              return;
            }
            setSelection(currentHistorySelection(pageId, userId));
            setAside({ tab: "history", isAsideOpen: !opened });
          }}
        >
          <IconHistory size={20} stroke={2} />
        </ActionIcon>
      </Tooltip>
    </>
  );
}

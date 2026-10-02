import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Provider, useAtomValue } from "jotai";
import { Badge, Button, Modal, Tooltip } from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import api from "@/lib/api-client";
import { VersionList, statusLabels } from "./history-types";
import { HistoryWorkspace } from "./history-workspace";

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
  const [opened, setOpened] = useState(false);
  const latest = useQuery({
    queryKey: ["sop-history-status", userId, pageId],
    queryFn: async ({ signal }) =>
      (
        await api.post<VersionList>(
          "/pages/versions/list",
          { pageId, summaries: false },
          { signal },
        )
      ).data,
    refetchInterval: (query) =>
      opened || query.state.data?.enabled === false ? false : 5000,
    retry: false,
    gcTime: 0,
  });
  if (latest.isError) return <Badge variant="light">版本状态暂不可用</Badge>;
  if (!latest.data?.enabled) return null;
  const recent = latest.data.items[0];
  return (
    <>
      <Tooltip
        label={
          recent
            ? `最近第 ${recent.revision} 版 · ${statusLabels[recent.status] || "状态未知"}`
            : "查看文档版本记录"
        }
      >
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconHistory size={16} />}
          onClick={() => setOpened(true)}
        >
          历史版本
        </Button>
      </Tooltip>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        fullScreen
        title="历史版本"
        withCloseButton={false}
        transitionProps={{ duration: 120 }}
        styles={{
          header: { display: "none" },
          body: { padding: 0 },
          content: { overflow: "hidden" },
        }}
      >
        {opened && (
          <Provider>
            <HistoryWorkspace
              pageId={pageId}
              userId={userId}
              onClose={() => setOpened(false)}
            />
          </Provider>
        )}
      </Modal>
    </>
  );
}

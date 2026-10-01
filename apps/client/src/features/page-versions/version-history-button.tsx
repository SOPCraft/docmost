import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { EditorProvider } from "@tiptap/react";
import { mainExtensions } from "@/features/editor/extensions/extensions";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import api from "@/lib/api-client";

interface VersionRow {
  id: string;
  revision: number;
  status: string;
  createdAt: string;
  actors: Array<{ id: string; name: string }>;
  lastErrorCode?: string;
}
interface VersionList {
  enabled: boolean;
  items: VersionRow[];
  hasMore: boolean;
}
interface VersionInfo {
  id: string;
  revision: number;
  title: string;
  content: any;
  actors: Array<{ id: string; name: string }>;
  exclusions: string[];
  deletedAt: string | null;
}
const statusLabels: Record<string, string> = {
  pending: "待同步",
  processing: "提交中",
  synced: "已入库",
  failed: "同步失败",
  blocked: "同步已阻断",
};

export default function VersionHistoryButton({ pageId }: { pageId: string }) {
  const userId = useAtomValue(currentUserAtom)?.user?.id;
  const [opened, setOpened] = useState(false);
  const [before, setBefore] = useState<number | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(null);
    setBefore(undefined);
    setOpened(false);
  }, [pageId, userId]);
  const latest = useQuery({
    queryKey: ["sop-versions-latest", userId, pageId],
    queryFn: async () =>
      (await api.post<VersionList>("/pages/versions/list", { pageId })).data,
    enabled: !!pageId && !!userId,
    refetchInterval: (query) => query.state.data?.enabled === false ? false : 3000,
    retry: false,
    gcTime: 0,
  });
  const older = useQuery({
    queryKey: ["sop-versions-list", userId, pageId, before],
    queryFn: async () =>
      (await api.post<VersionList>("/pages/versions/list", { pageId, before }))
        .data,
    enabled: opened && before !== undefined,
    retry: false,
    gcTime: 0,
  });
  const info = useQuery({
    queryKey: ["sop-version-info", userId, pageId, selected],
    queryFn: async () =>
      (
        await api.post<VersionInfo>("/pages/versions/info", {
          pageId,
          versionId: selected,
        })
      ).data,
    enabled: opened && !!selected && latest.data?.enabled === true,
    refetchInterval: opened ? 5000 : false,
    retry: false,
    gcTime: 0,
  });
  const list = before === undefined ? latest : older;
  if (latest.isError) return <Badge variant="light">版本状态暂不可用</Badge>;
  if (!latest.data?.enabled) return null;
  const recent = latest.data.items[0];
  return (
    <>
      <Button size="xs" variant="subtle" onClick={() => setOpened(true)}>
        {recent
          ? `最近第 ${recent.revision} 版 · ${statusLabels[recent.status] || "状态未知"}`
          : "版本记录"}
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="文档版本记录"
        size="xl"
      >
        <Stack>
          <Alert>
            当前可回读正文和表格；复杂排版会简化展示。旧版图片、附件、批注及动态引用尚未固定，不会用当前资料替代。
          </Alert>
          <Text size="sm" c="dimmed">
            这里显示已进入服务器保存流程的版本；尚在输入的内容不代表已经入库。
          </Text>
          {list.isError ? (
            <Alert color="red">
              无法读取版本列表，请检查访问权限或服务状态。
            </Alert>
          ) : (
            <>
              {list.isPending && <Loader size="sm" />}
              <Group>
                {(list.data?.items || []).map((row) => (
                  <Button
                    key={row.id}
                    size="xs"
                    variant={selected === row.id ? "filled" : "light"}
                    disabled={row.status !== "synced"}
                    onClick={() => setSelected(row.id)}
                  >
                    第 {row.revision} 版 ·{" "}
                    {statusLabels[row.status] || "状态未知"} ·{" "}
                    {row.actors.map((a) => a.name).join("、")}
                  </Button>
                ))}
              </Group>
              <Group>
                {before !== undefined && (
                  <Button
                    variant="subtle"
                    onClick={() => {
                      setBefore(undefined);
                      setSelected(null);
                    }}
                  >
                    返回最新记录
                  </Button>
                )}
                {list.data?.hasMore && (
                  <Button
                    variant="subtle"
                    onClick={() => {
                      setBefore(
                        list.data.items[list.data.items.length - 1]?.revision,
                      );
                      setSelected(null);
                    }}
                  >
                    查看更早版本
                  </Button>
                )}
              </Group>
              {!list.data?.items.length && !list.isPending && (
                <Text>尚无自动版本记录。</Text>
              )}
            </>
          )}
          {selected && info.isPending && <Loader size="sm" />}
          {selected && info.isError && (
            <Alert color="red">
              旧版本读取失败或访问权限已变更。没有使用最新内容替代。
            </Alert>
          )}
          {selected && !info.isError && info.data && (
            <>
              <Title order={3}>
                第 {info.data.revision} 版：{info.data.title || "未命名文档"}
              </Title>
              <Text size="sm">
                修改人：{info.data.actors.map((a) => a.name).join("、")}
                {info.data.deletedAt ? " · 此版记录了删除操作" : ""}
              </Text>
              <div className="editor-container" data-testid="version-snapshot">
                <EditorProvider
                  key={info.data.id}
                  editable={false}
                  immediatelyRender={true}
                  extensions={mainExtensions}
                  content={info.data.content}
                  editorProps={{ attributes: { "aria-label": "历史版本正文" } }}
                />
              </div>
            </>
          )}
        </Stack>
      </Modal>
    </>
  );
}

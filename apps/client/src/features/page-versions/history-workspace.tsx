import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMediaQuery } from "@mantine/hooks";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconList } from "@tabler/icons-react";
import api from "@/lib/api-client";
import { DatePickerInput } from "@mantine/dates";
import "dayjs/locale/zh-cn";
import { VersionActor, VersionList, localDateBoundary } from "./history-types";
import { VersionTimeline } from "./version-timeline";
import { VersionDetail } from "./version-detail";
import classes from "./history-workspace.module.css";

export function HistoryWorkspace({
  pageId,
  userId,
  onClose,
}: {
  pageId: string;
  userId: string;
  onClose: () => void;
}) {
  const mobile = useMediaQuery("(max-width: 760px)");
  const [mobileList, setMobileList] = useState(false);
  const [from, setFrom] = useState(""),
    [until, setUntil] = useState(""),
    [actorId, setActorId] = useState<string | null>(null);
  const [selection, setSelected] = useState<string | null>(null);
  const filter = useMemo(() => {
    try {
      const start = localDateBoundary(from),
        end = localDateBoundary(until, true);
      return {
        from: start,
        until: end,
        actorId: actorId || undefined,
        valid: !(start && end && start >= end),
      };
    } catch {
      return {
        from: undefined,
        until: undefined,
        actorId: undefined,
        valid: false,
      };
    }
  }, [from, until, actorId]);
  const options = useQuery({
    queryKey: ["history-options", userId, pageId],
    queryFn: async ({ signal }) =>
      (
        await api.post<{
          actors: VersionActor[];
          firstAt: string | null;
          lastAt: string | null;
        }>("/pages/versions/options", { pageId }, { signal })
      ).data,
    refetchInterval: 15000,
    retry: false,
    gcTime: 0,
  });
  const list = useInfiniteQuery({
    queryKey: ["history-timeline", userId, pageId, filter],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.post<VersionList>(
          "/pages/versions/list",
          {
            pageId,
            before: pageParam,
            from: filter.from,
            until: filter.until,
            actorId: filter.actorId,
          },
          { signal },
        )
      ).data,
    getNextPageParam: (last) =>
      last.hasMore ? last.items[last.items.length - 1]?.revision : undefined,
    enabled: filter.valid,
    refetchInterval: 10000,
    retry: false,
    gcTime: 0,
  });
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (list.data?.pages.flatMap((p) => p.items) || []).filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }, [list.data]);
  const selected =
    selection ?? rows.find((r) => r.status === "synced")?.id ?? null;
  const changeFilter = (fn: () => void) => {
    setSelected(null);
    fn();
  };
  const clear = () =>
    changeFilter(() => {
      setFrom("");
      setUntil("");
      setActorId(null);
    });
  const currentRow = rows.find((r) => r.id === selected);
  const error = list.isError || options.isError;
  return (
    <div className={classes.workspace} data-testid="history-workspace">
      <Group className={classes.header} justify="space-between" wrap="nowrap">
        <Group gap="md">
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={17} />}
            onClick={onClose}
            data-autofocus
          >
            返回当前文档
          </Button>
          <Title order={4}>历史版本</Title>
          <Badge variant="light" color="gray" className={classes.readOnlyBadge}>
            只读
          </Badge>
        </Group>
        {mobile && (
          <Button
            variant="light"
            size="xs"
            leftSection={<IconList size={15} />}
            onClick={() => setMobileList(!mobileList)}
          >
            {mobileList ? "查看正文" : "选择版本"}
          </Button>
        )}
      </Group>
      <div className={classes.layout}>
        <main
          className={`${classes.main} ${mobile && mobileList ? classes.hiddenMobile : ""}`}
          aria-label="历史正文与差异"
        >
          {!filter.valid ? (
            <div className={classes.empty}>
              <Text>请检查日期范围，结束日期不能早于开始日期。</Text>
            </div>
          ) : error ? (
            <div className={classes.empty}>
              <Alert color="red">
                历史记录暂不可用或访问权限已变更。
                <Button
                  variant="subtle"
                  onClick={() => {
                    list.refetch();
                    options.refetch();
                  }}
                >
                  重新加载
                </Button>
              </Alert>
            </div>
          ) : selected && currentRow ? (
            <VersionDetail
              key={`${pageId}:${selected}`}
              pageId={pageId}
              userId={userId}
              row={currentRow}
              olderRows={rows.filter(
                (r) =>
                  r.revision < currentRow.revision && r.status === "synced",
              )}
            />
          ) : (
            <div className={classes.empty}>
              {list.isPending ? (
                <Loader />
              ) : (
                <Stack align="center">
                  <Text>没有符合条件的版本</Text>
                  <Button variant="subtle" onClick={clear}>
                    清除筛选
                  </Button>
                </Stack>
              )}
            </div>
          )}
        </main>
        <aside
          className={`${classes.sidebar} ${mobile && !mobileList ? classes.hiddenMobile : ""}`}
          aria-label="历史版本筛选与列表"
        >
          <Stack className={classes.filters} gap="sm">
            <Group justify="space-between">
              <Text fw={600}>版本记录</Text>
              <Text size="xs" c="dimmed">
                {list.data?.pages[0]?.total ?? 0} 条
              </Text>
            </Group>
            <Group grow gap="xs" align="flex-start">
              <DatePickerInput
                label="开始日期"
                aria-label="开始日期"
                locale="zh-cn"
                valueFormat="YYYY-MM-DD"
                placeholder="选择日期"
                clearable
                size="xs"
                value={from || null}
                onChange={(value) => changeFilter(() => setFrom(value || ""))}
                getDayProps={(date) => ({ "aria-label": `开始 ${date}` })}
                clearButtonProps={{ "aria-label": "清除开始日期" }}
              />
              <DatePickerInput
                label="结束日期"
                aria-label="结束日期"
                locale="zh-cn"
                valueFormat="YYYY-MM-DD"
                placeholder="选择日期"
                clearable
                size="xs"
                value={until || null}
                onChange={(value) => changeFilter(() => setUntil(value || ""))}
                getDayProps={(date) => ({ "aria-label": `结束 ${date}` })}
                clearButtonProps={{ "aria-label": "清除结束日期" }}
              />
            </Group>
            <Select
              label="修改人"
              size="xs"
              placeholder="全部修改人"
              clearable
              searchable
              value={actorId}
              data={(options.data?.actors || []).map((a) => ({
                value: a.id,
                label: a.name,
              }))}
              onChange={(value) => changeFilter(() => setActorId(value))}
              nothingFoundMessage="没有匹配的修改人"
            />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                日期按本机时区显示
              </Text>
              <Button variant="subtle" size="compact-xs" onClick={clear}>
                清除筛选
              </Button>
            </Group>
            {!filter.valid && (
              <Text size="xs" c="red">
                日期范围无效
              </Text>
            )}
          </Stack>
          {error ? (
            <Text p="md" size="sm" c="red">
              无法读取历史
            </Text>
          ) : list.isPending && filter.valid ? (
            <div className={classes.empty}>
              <Loader size="sm" />
            </div>
          ) : (
            filter.valid && (
              <VersionTimeline
                key={`${from}:${until}:${actorId}`}
                rows={rows}
                selected={selected}
                onSelect={(id) => {
                  setSelected(id);
                  setMobileList(false);
                }}
                hasMore={!!list.hasNextPage}
                onMore={() => void list.fetchNextPage()}
                loading={list.isFetchingNextPage}
              />
            )
          )}
          <Text p="sm" size="xs" c="dimmed">
            停笔保存的记录，不是每次按键。悬停可查看改动摘要。
          </Text>
        </aside>
      </div>
    </div>
  );
}

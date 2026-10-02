import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMediaQuery } from "@mantine/hooks";
import {
  Alert,
  Button,
  Collapse,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconAdjustmentsHorizontal, IconFileText } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import {
  activeHistorySelection,
  historyDrawerSelectionAtom,
} from "./history-drawer-state";
import native from "@/features/page-history/components/css/history.module.css";
import api from "@/lib/api-client";
import { DatePickerInput } from "@mantine/dates";
import "dayjs/locale/zh-cn";
import { VersionActor, VersionList, localDateBoundary } from "./history-types";
import { VersionTimeline } from "./version-timeline";
import classes from "./history-workspace.module.css";

export function HistoryWorkspace({
  pageId,
  userId,
}: {
  pageId: string;
  userId: string;
}) {
  const mobile = useMediaQuery("(max-width: 47.99em)");
  const [filterOpen, setFilterOpen] = useState(false);
  const [stored, setStored] = useAtom(historyDrawerSelectionAtom);
  const [aside, setAside] = useAtom(asideStateAtom);
  const [from, setFrom] = useState(""),
    [until, setUntil] = useState(""),
    [actorId, setActorId] = useState<string | null>(null);

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
  const active = activeHistorySelection(stored, aside, pageId, userId);
  const selected = active?.row?.id ?? null;
  const setSelected = (id: string | null) => {
    const row = rows.find((r) => r.id === id) || null;
    setStored({
      pageId,
      userId,
      row,
      mobileContent: mobile && !!row,
      returnScrollTop: active?.row ? active.returnScrollTop : window.scrollY,
      olderRows: row
        ? rows.filter((r) => r.revision < row.revision && r.status === "synced")
        : [],
    });
  };
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
  const error = list.isError || options.isError;
  return (
    <div className={classes.drawer} data-testid="history-workspace">
      <UnstyledButton
        className={[
          native.history,
          classes.current,
          !selected ? native.active : "",
        ].join(" ")}
        data-testid="history-current"
        aria-pressed={!selected}
        onClick={() => {
          setSelected(null);
          if (mobile) setAside({ tab: "history", isAsideOpen: false });
        }}
      >
        <Group gap="xs" wrap="nowrap">
          <IconFileText size={18} stroke={1.5} />
          <div>
            <Text size="sm" fw={500}>
              当前版本
            </Text>
            <Text size="xs" c="dimmed">
              返回正在使用的文档
            </Text>
          </div>
        </Group>
      </UnstyledButton>
      <Group justify="space-between" py="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {list.data?.pages[0]?.total ?? 0} 条记录
        </Text>
        <Button
          variant="subtle"
          color="gray"
          size="compact-xs"
          leftSection={<IconAdjustmentsHorizontal size={14} />}
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(!filterOpen)}
        >
          筛选
        </Button>
      </Group>
      <Collapse expanded={filterOpen}>
        <Stack className={classes.filters} gap="xs">
          {" "}
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
      </Collapse>
      {error ? (
        <Alert color="red" title="历史记录暂不可用">
          <Text size="xs">请检查访问权限或重新加载。</Text>
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={() => {
              list.refetch();
              options.refetch();
            }}
          >
            重新加载
          </Button>
        </Alert>
      ) : !filter.valid ? (
        <Text size="sm" c="dimmed" p="sm">
          请检查日期范围
        </Text>
      ) : list.isPending ? (
        <div className={classes.empty}>
          <Loader size="sm" />
        </div>
      ) : list.data?.pages[0]?.enabled === false ? (
        <Text size="sm" c="dimmed">
          版本记录尚未启用
        </Text>
      ) : (
        <VersionTimeline
          key={[from, until, actorId].join(":")}
          rows={rows}
          selected={selected}
          onSelect={setSelected}
          hasMore={!!list.hasNextPage}
          onMore={() => void list.fetchNextPage()}
          loading={list.isFetchingNextPage}
        />
      )}
      {!error && !list.isPending && filter.valid && rows.length === 0 && (
        <Text size="sm" c="dimmed" p="xs">
          没有符合条件的版本
        </Text>
      )}
    </div>
  );
}

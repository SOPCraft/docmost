import { useParams } from "react-router-dom";
import { useAtomValue } from "jotai";
import { Text } from "@mantine/core";
import { extractPageSlugId } from "@/lib";
import { usePageQuery } from "@/features/page/queries/page-query";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { HistoryWorkspace } from "./history-workspace";

export default function HistorySidebar() {
  const { pageSlug } = useParams();
  const { data: page, isError } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });
  const userId = useAtomValue(currentUserAtom)?.user?.id;
  if (isError)
    return (
      <Text size="sm" c="dimmed">
        文档不可访问
      </Text>
    );
  return page && userId && !page.isBase ? (
    <HistoryWorkspace
      key={`${page.id}:${userId}`}
      pageId={page.id}
      userId={userId}
    />
  ) : null;
}

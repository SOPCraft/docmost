import {
  ActionIcon,
  Box,
  Group,
  ScrollArea,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import React, { lazy, ReactNode, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
import { ASIDE_PANEL_ID } from "@/hooks/use-toggle-aside.tsx";

const CommentListWithTabs = lazy(
  () => import("@/features/comment/components/comment-list-with-tabs.tsx"),
);
const TableOfContents = lazy(() =>
  import("@/features/editor/components/table-of-contents/table-of-contents.tsx").then(
    (m) => ({ default: m.TableOfContents }),
  ),
);
const AsideChatPanel = lazy(
  () => import("@/ee/ai-chat/components/aside-chat-panel"),
);
const PageDetailsAside = lazy(() =>
  import("@/features/page-details/components/page-details-aside.tsx").then(
    (m) => ({ default: m.PageDetailsAside }),
  ),
);

const HistorySidebar = lazy(
  () => import("@/features/page-versions/history-sidebar"),
);

const PiWorkbenchSidebar = lazy(() => import("@/features/page/components/header/pi-workbench-panel"));

import { shouldClosePiAside } from "@/features/page/components/header/pi-aside-keyboard";

export default function Aside() {
  const [{ tab, isAsideOpen }, setAsideState] = useAtom(asideStateAtom);
  const { t } = useTranslation();
  const pageEditor = useAtomValue(pageEditorAtom);
  const closeAside = () => {
    setAsideState((s) => ({ ...s, isAsideOpen: false }));
    if (tab === "history" || tab === "pi")
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(tab === 'pi' ? '[data-testid="pi-workbench-trigger"]' : '[data-testid="history-trigger"]')
          ?.focus(),
      );
  };

  useEffect(() => {
    if (!isAsideOpen) return;
    const panel = document.getElementById(ASIDE_PANEL_ID);
    if (tab === "history")
      panel?.querySelector<HTMLElement>("[data-history-panel-body]")?.focus();
    else panel?.focus();
  }, [isAsideOpen, tab]);

  let title: string;
  let component: ReactNode;

  switch (tab) {
    case "pi":
      component = <PiWorkbenchSidebar />;
      title = "智能体对话";
      break;
    case "history":
      component = isAsideOpen ? <HistorySidebar /> : null;
      title = "Page history";
      break;
    case "comments":
      component = <CommentListWithTabs />;
      title = "Comments";
      break;
    case "toc":
      component = <TableOfContents editor={pageEditor} />;
      title = "Table of contents";
      break;
    case "chat":
      component = <AsideChatPanel />;
      title = "AI Chat";
      break;
    case "details":
      component = <PageDetailsAside />;
      title = "Details";
      break;
    default:
      component = null;
      title = null;
  }

  return (
    <Box
      p={tab === "pi" ? 18 : "md"}
      tabIndex={tab === "history" || tab === "pi" ? -1 : undefined}
      data-history-panel-body={tab === "history" ? "true" : undefined}
      onKeyDown={(e) => {
        if (tab === "pi" ? shouldClosePiAside(e) : tab === "history" && e.key === "Escape" && !e.defaultPrevented)
          closeAside();
      }}
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {component && (
        <>
          {tab !== "chat" && (
            <Group justify="space-between" wrap="nowrap" mb={tab === "pi" ? 10 : "md"}>
              <Title order={2} size="h6" fw={tab === "pi" ? 600 : 500}>
                {t(title)}
              </Title>
              <Tooltip label={t("Close")} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={closeAside}
                  aria-label={t("Close")}
                >
                  <IconX size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}

          <Suspense fallback={null}>
            {tab === "comments" || tab === "chat" || tab === "history" || tab === "pi" ? (
              component
            ) : (
              <ScrollArea
                style={{ height: "85vh" }}
                scrollbarSize={5}
                type="scroll"
              >
                <div style={{ paddingBottom: "200px" }}>{component}</div>
              </ScrollArea>
            )}
          </Suspense>
        </>
      )}
    </Box>
  );
}

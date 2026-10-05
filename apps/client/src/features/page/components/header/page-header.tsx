import { HistoryPreviewStatus } from "@/features/page-versions/history-preview-status";
import classes from "./page-header.module.css";
import HandbookButton from "./handbook-button";
import PiWorkbenchButton from "./pi-workbench-button";
import PageHeaderMenu from "@/features/page/components/header/page-header-menu.tsx";
import { Badge, Group, Tooltip } from "@mantine/core";
import { IconExternalLink, IconWorld } from "@tabler/icons-react";
import Breadcrumb from "@/features/page/components/breadcrumbs/breadcrumb.tsx";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import { extractPageSlugId } from "@/lib";
import { buildPublicSpaceUrl } from "@/features/page/page.utils.ts";
import { isBetaPublicSpaces } from "@/lib/config.ts";

interface Props {
  readOnly?: boolean;
}
export default function PageHeader({ readOnly }: Props) {
  const { t } = useTranslation();
  const { spaceSlug, pageSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const { data: page } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });

  // Restricted pages are never publicly reachable, so the chip only shows on
  // pages the public site actually serves.
  const showPublicBadge =
    isBetaPublicSpaces() &&
    space?.isPublished &&
    page &&
    page.permissions?.hasRestriction !== true;

  return (
    <div className={classes.header} data-page-header="true">
      <Group
        justify="space-between"
        h="100%"
        px="md"
        wrap="nowrap"
        className={classes.group}
      >
        <Group gap="xs" wrap="nowrap" className={classes.titleRail}>
          <div className={classes.breadcrumbSlot}>
            <Breadcrumb />

            {showPublicBadge && (
              <Tooltip label={t("Open public page")} openDelay={250} withArrow>
                <Badge
                  component="a"
                  href={buildPublicSpaceUrl({
                    spaceSlug: space.slug,
                    pageSlugId: page.slugId,
                    pageTitle: page.title,
                  })}
                  target="_blank"
                  rel="noopener"
                  size="sm"
                  variant="light"
                  leftSection={<IconWorld size={12} />}
                  rightSection={<IconExternalLink size={11} />}
                  style={{ flexShrink: 0, cursor: "pointer" }}
                >
                  {t("Public")}
                </Badge>
              </Tooltip>
            )}
          </div>
          {page?.id && <HistoryPreviewStatus pageId={page.id} />}
        </Group>

        <Group
          className={classes.actions}
          data-testid="page-header-actions"
          justify="flex-end"
          h="100%"
          px="md"
          wrap="nowrap"
          gap="var(--mantine-spacing-xs)"
        >
          {page?.id && <PiWorkbenchButton />}
          {page?.id && <HandbookButton pageId={page.id} readOnly={readOnly || page.permissions?.canEdit === false} />}
          <PageHeaderMenu readOnly={readOnly} />
        </Group>
      </Group>
    </div>
  );
}

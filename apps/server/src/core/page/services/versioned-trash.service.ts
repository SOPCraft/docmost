import {
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'kysely';
import { KyselyDB } from '../../../database/types/kysely.types';
import { PageRepo } from '../../../database/repos/page/page.repo';
import { PagePermissionRepo } from '../../../database/repos/page/page-permission.repo';
import { VersionCaptureService } from '../../../integrations/versioning/version-capture.service';
import { EventName } from '../../../common/events/event.contants';

@Injectable()
export class VersionedTrashService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pages: PageRepo,
    private readonly permissions: PagePermissionRepo,
    private readonly capture: VersionCaptureService,
    private readonly events: EventEmitter2,
  ) {}

  async change(
    pageId: string,
    workspaceId: string,
    actorId: string,
    deleted: boolean,
  ): Promise<void> {
    const root = await this.pages.findById(pageId);
    if (!root || root.workspaceId !== workspaceId)
      throw new NotFoundException('Page not found');
    const changed = await this.db.transaction().execute(async (trx) => {
      await this.pages.lockPageHierarchySpaces([root.spaceId], trx);
      const current = await this.pages.findById(root.id, {
        withLock: true,
        trx,
      });
      if (!current || current.workspaceId !== workspaceId)
        throw new NotFoundException('Page not found');
      if (current.spaceId !== root.spaceId)
        throw new ConflictException('Page location changed');
      const rows = (
        await sql<{ id: string }>`WITH RECURSIVE subtree AS (
        SELECT id FROM pages WHERE id=${root.id}::uuid AND workspace_id=${workspaceId}::uuid
        UNION SELECT p.id FROM pages p JOIN subtree t ON p.parent_page_id=t.id
          WHERE p.workspace_id=${workspaceId}::uuid AND p.space_id=${root.spaceId}::uuid
      ) SELECT id FROM subtree ORDER BY id`.execute(trx)
      ).rows;
      const ids = rows.map((row) => row.id);
      const pages = await trx
        .selectFrom('pages')
        .select(['id', 'deletedAt', 'parentPageId'])
        .where('id', 'in', ids)
        .orderBy('id')
        .forUpdate()
        .execute();
      for (const page of pages) {
        const permission = await this.permissions.canUserEditPage(
          actorId,
          page.id,
          { trx },
        );
        if (permission.hasAnyRestriction && !permission.canEdit)
          throw new ForbiddenException('Cannot change restricted descendant');
      }
      const changedIds = pages
        .filter((p) => Boolean(p.deletedAt) !== deleted)
        .map((p) => p.id);
      if (!changedIds.length) return [];
      await trx
        .updateTable('pages')
        .set({
          deletedAt: deleted ? new Date() : null,
          deletedById: deleted ? actorId : null,
          lastUpdatedById: actorId,
          updatedAt: new Date(),
        })
        .where('id', 'in', changedIds)
        .execute();
      if (deleted)
        await trx
          .deleteFrom('shares')
          .where('pageId', 'in', changedIds)
          .execute();
      else if (current.parentPageId) {
        const parent = await trx
          .selectFrom('pages')
          .select(['deletedAt'])
          .where('id', '=', current.parentPageId)
          .executeTakeFirst();
        if (!parent || parent.deletedAt)
          await trx
            .updateTable('pages')
            .set({ parentPageId: null })
            .where('id', '=', current.id)
            .execute();
      }
      for (const id of changedIds)
        await this.capture.capture(trx, {
          pageId: id,
          workspaceId,
          actorIds: [actorId],
          allowDeleted: deleted,
        });
      return changedIds;
    });
    if (changed.length)
      this.events.emit(
        deleted ? EventName.PAGE_SOFT_DELETED : EventName.PAGE_RESTORED,
        { pageIds: changed, workspaceId },
      );
  }
}

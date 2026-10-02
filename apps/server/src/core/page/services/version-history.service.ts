import {
  HistoryFilters,
  validateHistoryFilters,
} from '../../../integrations/versioning/history-filters';
import { summarizeHistory } from '../../../integrations/versioning/history-summary';
import {
  Injectable,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '../../../database/types/kysely.types';
import { PageRepo } from '../../../database/repos/page/page.repo';
import { PageAccessService } from '../page-access/page-access.service';
import { User } from '../../../database/types/entity.types';
import { GiteaClient } from '../../../integrations/versioning/gitea.client';
import { readVersioningConfig } from '../../../integrations/versioning/versioning.config';
import {
  VersionTask,
  SpaceBinding,
} from '../../../integrations/versioning/version-delivery.types';
import { canonicalJson } from '../../../integrations/versioning/version-snapshot';
import { snapshotBytes } from '../../../integrations/versioning/version-delivery.validation';
import { safeHistoryContent } from '../../../integrations/versioning/history-safe-content';
import { SpaceMemberRepo } from '../../../database/repos/space/space-member.repo';
import { PagePermissionRepo } from '../../../database/repos/page/page-permission.repo';
import { ForbiddenException } from '@nestjs/common';

@Injectable()
export class VersionHistoryService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pages: PageRepo,
    private readonly access: PageAccessService,
    private readonly client: GiteaClient,
    private readonly members: SpaceMemberRepo,
    private readonly pagePermissions: PagePermissionRepo,
  ) {}
  private async authorize(pageId: string, user: User) {
    const page = await this.pages.findById(pageId);
    if (!page || page.workspaceId !== user.workspaceId)
      throw new NotFoundException('Page not found');
    await this.access.validateCanView(page, user);
    const roles = await this.members.getUserRolesForSpaces(user.id, [
      page.spaceId,
    ]);
    const permissions = await this.pagePermissions.canUserEditPage(
      user.id,
      page.id,
      { fresh: true },
    );
    if (
      !roles.some((role) =>
        ['admin', 'writer', 'reader'].includes(role.role),
      ) ||
      !permissions.canAccess
    ) {
      throw new ForbiddenException('History access has been revoked');
    }
    return page;
  }
  async list(
    pageId: string,
    user: User,
    before?: number,
    input: HistoryFilters = {},
  ) {
    const filters = validateHistoryFilters(input, before);
    const page = await this.authorize(pageId, user);
    if (!readVersioningConfig().enabled)
      return { enabled: false, items: [], hasMore: false, total: 0 };
    const scope = sql`v.workspace_id=${user.workspaceId}::uuid AND v.space_id=${page.spaceId}::uuid AND v.page_id=${page.id}::uuid`;
    const predicate = sql`${scope}
      ${filters.from ? sql`AND v.created_at >= ${filters.from}::timestamptz` : sql``}
      ${filters.until ? sql`AND v.created_at < ${filters.until}::timestamptz` : sql``}
      ${filters.actorId ? sql`AND v.snapshot->'actors' @> ${JSON.stringify([{ id: filters.actorId }])}::text::jsonb` : sql``}`;
    const include = filters.summaries !== false;
    const safePage = (
      alias: string,
    ) => sql`CASE WHEN octet_length(${sql.ref(alias + '.snapshot')}::text) < 128000 THEN ${sql.ref(alias + '.snapshot')}->'page'
      ELSE (${sql.ref(alias + '.snapshot')}->'page') - 'content' - 'ydocBase64' END`;
    const rows = (
      await sql<any>`SELECT v.id, v.revision, v.status, v.attempts, v.commit_sha, v.created_at, v.synced_at,
      v.last_error_code, v.snapshot->'actors' AS actors, v.snapshot->>'scope' AS scope, v.snapshot->'exclusions' AS exclusions
      ${
        include
          ? sql`, ${safePage('v')} AS summary_page, ${safePage('p')} AS previous_page, p.id AS previous_id, p.revision AS previous_revision,
        (octet_length(v.snapshot::text) >= 128000 OR coalesce(octet_length(p.snapshot::text),0) >= 128000) AS summary_limited`
          : sql``
      }
      FROM sop_page_versions v
      ${
        include
          ? sql`LEFT JOIN sop_page_versions p ON p.workspace_id=v.workspace_id AND p.space_id=v.space_id
        AND p.page_id=v.page_id AND p.revision=v.revision-1`
          : sql``
      }
      WHERE ${predicate} ${before ? sql`AND v.revision < ${before}` : sql``}
      ORDER BY v.revision DESC LIMIT 31`.execute(this.db)
    ).rows;
    const count = (
      await sql<{
        total: number;
      }>`SELECT count(*)::integer AS total FROM sop_page_versions v WHERE ${predicate}`.execute(
        this.db,
      )
    ).rows[0].total;
    const checked = await this.authorize(page.id, user);
    if (checked.spaceId !== page.spaceId)
      throw new ConflictException('Page location changed');
    const items = rows
      .slice(0, 30)
      .map(
        ({
          summaryPage,
          previousPage,
          summaryLimited,
          previousId,
          previousRevision,
          ...row
        }) => ({
          ...row,
          ...(include
            ? {
                previousId,
                previousRevision,
                summary:
                  row.revision > 1 && !previousId
                    ? {
                        label: '比较基准缺失',
                        details: ['未找到同文档上一版，不能推断变化。'],
                        added: null,
                        deleted: null,
                        limited: true,
                        metadataChanged: false,
                        structureChanged: false,
                      }
                    : summarizeHistory(
                        summaryPage,
                        previousPage,
                        summaryLimited,
                      ),
              }
            : {}),
        }),
      );
    return { enabled: true, items, hasMore: rows.length > 30, total: count };
  }
  async options(pageId: string, user: User) {
    const page = await this.authorize(pageId, user);
    if (!readVersioningConfig().enabled)
      return { actors: [], firstAt: null, lastAt: null };
    const actors = (
      await sql<{
        id: string;
        name: string;
      }>`SELECT DISTINCT ON (a->>'id') a->>'id' AS id, a->>'name' AS name
      FROM sop_page_versions v CROSS JOIN LATERAL jsonb_array_elements(v.snapshot->'actors') a
      WHERE v.workspace_id=${user.workspaceId}::uuid AND v.space_id=${page.spaceId}::uuid AND v.page_id=${page.id}::uuid
      ORDER BY a->>'id', v.revision DESC`.execute(this.db)
    ).rows;
    const dates = (
      await sql<{
        firstAt: Date | null;
        lastAt: Date | null;
      }>`SELECT min(created_at) AS first_at, max(created_at) AS last_at
      FROM sop_page_versions WHERE workspace_id=${user.workspaceId}::uuid AND space_id=${page.spaceId}::uuid AND page_id=${page.id}::uuid`.execute(
        this.db,
      )
    ).rows[0];
    const checked = await this.authorize(page.id, user);
    if (checked.spaceId !== page.spaceId)
      throw new ConflictException('Page location changed');
    return { actors, ...dates };
  }
  async compare(
    pageId: string,
    versionId: string,
    user: User,
    baseVersionId?: string,
  ) {
    const current = await this.read(pageId, versionId, user);
    const page = await this.authorize(pageId, user);
    const selected = (
      await sql<{
        id: string;
        revision: number;
        page: any;
      }>`SELECT id, revision, snapshot->'page' AS page FROM sop_page_versions
      WHERE id=${versionId}::uuid AND page_id=${page.id}::uuid AND space_id=${page.spaceId}::uuid AND workspace_id=${user.workspaceId}::uuid`.execute(
        this.db,
      )
    ).rows[0];
    if (!selected) throw new NotFoundException('Version not found');
    const base =
      current.revision === 1 && !baseVersionId
        ? null
        : (
            await sql<{
              id: string;
              revision: number;
              page: any;
            }>`SELECT id, revision, snapshot->'page' AS page FROM sop_page_versions
      WHERE page_id=${page.id}::uuid AND space_id=${page.spaceId}::uuid AND workspace_id=${user.workspaceId}::uuid
      AND ${baseVersionId ? sql`id=${baseVersionId}::uuid AND revision<${current.revision}` : sql`revision=${current.revision - 1}`}`.execute(
              this.db,
            )
          ).rows[0];
    if (!base && (current.revision > 1 || baseVersionId))
      throw new ConflictException('Comparison baseline unavailable');
    const previous = base ? await this.read(pageId, base.id, user) : null;
    const checked = await this.authorize(pageId, user);
    if (checked.spaceId !== page.spaceId)
      throw new ConflictException('Page location changed');
    return {
      current,
      previous,
      summary: summarizeHistory(selected.page, base?.page || null),
      baseline: base ? { id: base.id, revision: base.revision } : null,
    };
  }
  async read(pageId: string, versionId: string, user: User) {
    const page = await this.authorize(pageId, user);
    if (!readVersioningConfig().enabled)
      throw new ConflictException('Version history is disabled');
    const task = (
      await sql<VersionTask>`SELECT * FROM sop_page_versions
      WHERE id=${versionId}::uuid AND workspace_id=${user.workspaceId}::uuid
        AND space_id=${page.spaceId}::uuid AND page_id=${page.id}::uuid`.execute(
        this.db,
      )
    ).rows[0];
    if (!task) throw new NotFoundException('Version not found');
    if (task.status !== 'synced' || !task.commitSha)
      throw new ConflictException('Version has not reached the repository');
    const binding = (
      await sql<SpaceBinding>`SELECT * FROM sop_version_spaces WHERE workspace_id=${user.workspaceId}::uuid
      AND space_id=${page.spaceId}::uuid`.execute(this.db)
    ).rows[0];
    if (!binding?.repoId)
      throw new ConflictException('Version repository binding is unavailable');
    const root = this.client.repoPath(binding.orgName, binding.repoName);
    let envelope: any;
    try {
      snapshotBytes(task);
      const repo = await this.client.request<{
        id: number;
        private: boolean;
        description: string;
      }>(root);
      const marker = `sop-space/1:${this.client.config.instanceId}:${user.workspaceId}:${page.spaceId}`;
      if (
        String(repo.id) !== String(binding.repoId) ||
        repo.private !== true ||
        repo.description !== marker
      )
        throw new Error('Repository changed');
      const file = await this.client.file(
        root,
        `.sop/versions/${task.id}.json`,
        task.commitSha,
      );
      if (!file) throw new Error('Snapshot missing');
      envelope = JSON.parse(
        Buffer.from(file.content, 'base64').toString('utf8'),
      );
      if (
        envelope.schema !== 'sop.delivery/1' ||
        envelope.taskId !== task.id ||
        envelope.revision !== task.revision ||
        envelope.snapshotSha256 !== task.snapshotSha256.trim() ||
        canonicalJson(envelope.snapshot) !== snapshotBytes(task)
      )
        throw new Error('Snapshot mismatch');
    } catch {
      throw new ServiceUnavailableException(
        'Historical snapshot is unavailable or invalid; current content was not substituted',
      );
    }
    const authorized = await this.authorize(page.id, user);
    if (authorized.spaceId !== page.spaceId)
      throw new ConflictException('Page location changed');
    return {
      id: task.id,
      revision: task.revision,
      commitSha: task.commitSha,
      createdAt: task.createdAt,
      actors: envelope.snapshot.actors,
      scope: envelope.snapshot.scope,
      exclusions: envelope.snapshot.exclusions,
      title: envelope.snapshot.page.title,
      content: safeHistoryContent(envelope.snapshot.page.content),
      deletedAt: envelope.snapshot.page.deletedAt,
    };
  }
}
